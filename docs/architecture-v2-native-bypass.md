# NapukettoQQ 最终架构决策与执行指南（V2：Native Bypass 混合模式）

> **状态**：2026-08-06 用户拍板定稿。取代 AGENTS.md 第 7 条（V1 纯 NAPI 注入路线）。
> **用途**：本文档是完整架构决策书，可直接复制粘贴给 AI IDE（Cursor / Windsurf / VSCode Copilot）
> 作为下一阶段（Ghidra 逆向 + C++ Loader）的权威上下文。
> **配套**：`docs/ghidra-mcp-guide.md`（GhidraMCP 已配置，wrapper.node 已分析）。

> ## 🏆 重大更新（2026-08-06 晚）：自建宿主路线已实测验证，推翻「必须注入 QQ 主进程」前提
>
> 在继续阅读本文档之前，请先看 §1.4「自建宿主（标准 Node 独立进程）」——这是**新的最优路线**：
> 标准 Node + `LoadLibrary(QQNT.dll)` + `LoadLibrary(wrapper.node)` + koffi 调用
> `CreateNTSessionShell` 已实测**成功创建真实 session 对象**（`0x1faef126030`），
> 无需 QQ UI / 渲染 / GPU 进程，内存直接对标 NapCat 的 50-100MB。
> 本文档 §2-§6 的「注入 QQ 主进程」方案降级为备选（保留 C++ 载具知识沉淀）。

---

## 0. 决策背景（为什么必须转向）

**QQ 9.9.31-49919 实测结论（2026-08-05，多次注入验证）**：

| 尝试 | 结果 |
|---|---|
| 主进程 `new` / `create()` / 捕获 QQ session | `getMsgService`/`init` 断言 `implementation of IQQNTWrapperSession is not valid`（无 `cpp_impl`） |
| 登录后替换新捕获 session | 快速登录路径无新捕获，等待超时 |
| 渲染进程 `executeJavaScript` 注入 | `contextIsolation` 隔离，window 仅标准 DOM，无 QQNT API |
| `RM_IPCFROM_RENDERER*` ntApi 分发器 | 处理器是 `[native code]`（C++ 层），JS 不可调用 |

**结论**：9.9.31 把 session 真实初始化（`cpp_impl` 实例化）下沉到 C++ 层 + 渲染进程隔离，
纯 Electron JS/API 路线（V1）被完全封死。NapCat 现役方案（shell 模式）正是靠
**Native bypass 库**（Napi2NativeLoader）突破的——我们自研等价物，零引入其代码。

**但 2026-08-06 晚的逆向发现改变了局面**：wrapper.node 的全部依赖（v8/node/napi/qq_magic）
都从 QQNT.dll 常规导入——**QQNT.dll 是可独立加载的宿主桥接层**，标准 Node 进程即可加载
wrapper.node 并创建 session。详见 §1.4。

---

## 1. 核心定位与技术路线（V2 定稿）

> ## ⚠️ 逆向界限与红线（Strict Boundary）——项目第一原则
>
> **1. 目的单一性**：C++ Native 逆向与 Hook **有且仅有一个目的**——在内存中阻断 UI 渲染进程/GPU 进程以降低内存，并模拟触发 `cpp_impl` 的激活信号。
> **2. 业务逻辑零逆向**：所有 QQNT 的业务功能（收发消息、事件监听、数据解析）**必须 100% 严格走官方 NAPI 导出的 JS 接口**，严禁在 C++ 层进行业务逻辑的 Hook 或协议篡改。
>
> 逆向范围**严格限制在**「切断 UI / 压制内存 / 触发 Session 激活」三件事上；业务功能绝不混入 C++ Hook 层。

### 1.1 混合模式总览

```
┌─────────────────────────────────────────────────────────────┐
│  业务层（开源，JS/NAPI）                                        │
│  pnpm monorepo：kernel / adapter / network / media / cli       │
│  通过纯 NAPI 调用 wrapper.node 业务 API（getMsgService 等）      │
├─────────────────────────────────────────────────────────────┤
│  载具层（私有，C++ Native）                                     │
│  loader/native/：Bypass DLL + BootMain                         │
│  ① NOP wrapper.node 环境自检 + self-register 校验               │
│  ② 激活 session 的 cpp_impl（伪造 C++ 层初始化信号）              │
│  ③ 阻断 Chromium UI / GPU / Renderer（无头 + 低内存）            │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 分层职责（保持现有 monorepo，只改 loader 定位）

| 包 | 职责 | 变更 |
|---|---|---|
| `@napuketto/kernel` | NAPI 业务层（apis/listeners/cache） | **基本不变**（纯 NAPI 调用） |
| `@napuketto/adapter` | 协议适配器（onebot11/satori） | 不变 |
| `@napuketto/network` | 传输原语 | 不变 |
| `@napuketto/media` | 媒体处理 | 不变 |
| `apps/cli` | 启动编排 | 微调（载具启动方式） |
| `@napuketto/loader` | **Native Bypass 载具**（C++） | **核心重构**：注入 → bypass+激活+无头 |

### 1.3 关键优势

- **无头运行**：阻断 Chromium UI，50MB~100MB 低内存（对标 NapCat shell）。
- **解除渲染进程依赖**：不再需要 QQ 渲染进程驱动 session init。
- **业务层零改动**：现有 78 个 OneBot 动作 + kernel apis 全保留。

---

## 2. 许可证策略（双轨）

| 层 | 许可 | 说明 |
|---|---|---|
| 主框架（JS/NAPI 业务层） | **MIT / Apache-2.0 双重许可** | 开源，社区生态扩展 |
| Native Bypass 载具（C++ Hook DLL） | **私有**（源码私有仓库，仅分发混淆/加壳二进制） | 保护 Hook 点与 Offset |

**目的**：避免 GPL 强制开源底层 Hook 点与 Offset，保护逆向成果不被腾讯风控
特征码快速拉黑，延长对抗生命周期。

**注意**：NapCat 是 GPL-2.0-only，与 MIT/Apache 不兼容——**零引入 NapCat 代码**
（含类型定义）的红线不变，接口签名是外部系统事实可自研描述。

---

## 3. 三步走路线图

### 3.1 第一阶段：Ghidra 静动态逆向定位

**目标函数（wrapper.node / QQNT.dll）**：

| 优先级 | 目标 | 定位方法 | 预期产出 |
|---|---|---|---|
| P0 | self-register 校验点 | `/strings` 找 "Module did not self-register" → xref | NOP 目标地址 |
| P0 | `NodeIQQNTWrapperSession::init` 的 cpp_impl 赋值 | INTSessionShell vtable 槽位 16（RVA `0x37186` 候选）→ decompile | cpp_impl 激活函数地址 |
| P1 | 环境自检（napi_env 有效性 / 宿主校验） | 交叉引用 napi_* 调用点 | bypass 目标清单 |
| P1 | Session 初始化信号（onOpentelemetryInit / onSessionInitComplete 触发链） | 找 is_init=true 赋值点 | 伪造信号方案 |

**工具**：Ghidra 12.1.2 + GhidraMCP 1.4（已配置，见 `docs/ghidra-mcp-guide.md`），
wrapper.node 已全量分析于 `C:\Dev\Tools\ghidra-project\NapukettoWrapper.gpr`。

### 3.2 第二阶段：C++ 极简 Native Loader

**技术选型**（无痕优先）：

| 方案 | 说明 | 优先级 |
|---|---|---|
| IAT Hook（数据段指针替换） | 改写导入表槽位值，不碰代码段 → 不触发 CFG | ⭐ 首选（V1 hookdll 已验证） |
| 数据段指针替换 | 直接改全局函数指针变量 | 次选 |
| HWBP（硬件断点） | 单线程安全，需 DEBUG 寄存器 | 备选 |
| inline hook | 含分支需搬移，栈溢出风险 | ❌ 排除（V1 v6 踩过坑） |

**载具 DLL 职责**：
1. NOP/绕过 self-register 校验 → wrapper.node 在自建宿主可加载。
2. 激活 session cpp_impl（调用定位到的赋值函数，或伪造初始化信号）。
3. 阻断 BrowserWindow 创建 / GPU 进程（`--disable-gpu` + 窗口拦截）。

**宿主进程**：自建极简 Electron/Node 宿主（复用 V1 的 launcher 结构），
不启动 QQ UI。

### 3.2.1 【新最优路线】自建宿主（标准 Node 独立进程）——2026-08-06 实测验证

> **推翻前提**：原 V2 假设「必须注入 QQ 主进程」。逆向发现 wrapper.node 的
> **全部依赖（v8/node/napi/qq_magic）都从 QQNT.dll 常规导入**——QQNT.dll 是
> 可独立加载的宿主桥接层，**标准 Node 进程即可加载 wrapper.node 并创建 session**。

**逆向事实链（2026-08-06 验证）**：

| 事实 | 证据 |
|---|---|
| `qq_magic_napi_register` 是 wrapper.node 对 QQNT.dll 的**常规导入**（非 delay-load） | pefile 解析 Import Table：QQNT.dll 段含 `qq_magic_napi_register` + 全套 `napi_*` + v8 `Isolate` + node `AsyncResource` |
| QQNT.dll 导出全套宿主符号 | llvm-objdump：ord 3021 `qq_magic_napi_register` @ RVA 0x1AFB720、`napi_call_function` 等全部导出 |
| QQNT.dll 可独立加载 | PowerShell P/Invoke `LoadLibraryW` 成功；GetProcAddress 解析 RVA 与静态一致 |
| wrapper.node 无标准 NAPI 注册函数 | 导出表仅 33 个 MSVC mangled 符号（INTSessionShell 工厂等） |
| **标准 Node 可加载 wrapper.node 并创建 session** | `LoadLibraryA(wrapper.node)` 成功 @ 0x7FFF24F30000；koffi 调用 `CreateNTSessionShell("Session")` 返回真实对象指针 `0x1faef126030` |

**自建宿主架构（最终定稿，NapCat 级 50-100MB）**：

```
标准 Node（自建宿主）~50MB
  ├── LoadLibrary(QQNT.dll)          → 提供 v8/napi/node/qq_magic 桥接
  ├── LoadLibrary(wrapper.node)      → 业务模块（常规导入自动绑定）
  ├── koffi 调用 CreateNTSessionShell → 创建 session ✅ 已实测
  └── 激活链（FUN_180025d63 → FUN_180025d9d 注册 → FUN_180028756 init）→ 业务可用
```

**关键实现细节**：
- **DLL 搜索路径**：必须包含 `versions\9.9.31-49919`（QQNT.dll）+ `resources\app`（libvips-42.dll、crypto.dll、opencv.dll、ncnn.dll 等）
- **绕过 Node self-register 检查**：标准 Node 的 `process.dlopen` 硬查 `nm_register_func`（wrapper.node 没有）→ 用 `LoadLibraryA` 替代
- **koffi 3.x API**（与 V1 的 1.x 不同）：
  - `lib.func(symbol, returnType, [argTypes])` —— 符号名第一参数
  - `koffi.alloc(type, count)` —— 需要 2 参数（类型+数量）
  - MSVC x64 返回结构体（shared_ptr 16 字节）→ 返回缓冲指针是 rcx，真参数在 rdx
- **登录流程待确认**：Node 宿主下 loginService 来源（wrapper.node 导出 or QQNT.dll 内部服务）

**优势**（对比注入 QQ 主进程）：
- ✅ 无 QQ UI / 渲染 / GPU 进程 = NapCat 级低内存
- ✅ 完全绕过 QQ 进程注入（无反注入检测风险）
- ✅ 不修改 QQ 安装目录（零磁盘篡改红线天然满足）
- ✅ 业务层（kernel/adapter）仅需恢复 koffi 方案（V1 已实现过）

### 3.3 第三阶段：NAPI 业务层无缝对接

- `boot.cjs` 捕获被载具激活的有效 session。
- 现有 `kernel.NapukettoCore` / apis / adapter 全复用（无需改业务代码）。
- `startProtocols` 装配不变。

---

## 4. 反检测对抗策略（工程要求）

1. **无固定特征**：Hook 点 / Offset 不硬编码进公共代码，载具内动态解析（RVA 换算）。
2. **混淆/加壳**：载具二进制分发前混淆（如 LLVM-Obfuscator / 商业加壳）。
3. **行为仿真**：载具在宿主进程内模拟 QQ 主进程必要环境（进程名/路径/环境变量），
   避免被腾讯风控通过进程画像识别。
4. **不修改 QQ 安装目录**：所有 patch 在内存中进行，磁盘零改动（红线保留）。
5. **更新对抗**：QQ 升级后重跑 Ghidra 定位新 RVA，载具参数化配置。

---

## 5. VSCode 插件 & Ghidra MCP 配置建议

### 5.1 VSCode 插件（C++ 载具开发）

| 插件 | 用途 |
|---|---|
| **C/C++ Extension Pack（Microsoft）** | 编写 C++ Hook DLL 必备（IntelliSense/调试） |
| **CMake Tools** | 构建 Native Loader DLL |
| **x64dbg / Cheat Engine**（可选） | 运行时动态调试辅助（Ghidra 静态为主） |

### 5.2 Ghidra MCP（强烈建议，已配置）

**为什么需要**：AI IDE 只能看到项目源码，看不到 Ghidra 的反汇编/伪代码。
GhidraMCP 让 AI IDE 直接读取正在分析的函数符号、反汇编、结构体。

**已就绪（`docs/ghidra-mcp-guide.md`）**：
```
VS Code (MCP 客户端, .vscode/mcp.json) → SSE 8081 → bridge_mcp_ghidra.py → HTTP 8080 → Ghidra GUI
```

**启动步骤**：
```powershell
# 1. 启动 Ghidra + 打开 NapukettoWrapper.gpr
C:\Dev\Tools\ghidra_12.1.2_PUBLIC\ghidraRun.bat

# 2. 启动 Python 桥
python "C:\Dev\Tools\GhidraMCP-1-4\GhidraMCP-release-1-4\bridge_mcp_ghidra.py" --transport sse --mcp-host 127.0.0.1 --mcp-port 8081 --ghidra-server http://127.0.0.1:8080/

# 3. VSCode 重载 MCP（命令面板 → MCP: List Servers）
```

**对 AI 的典型指令**：
```
帮助分析 Ghidra 中 NodeIQQNTWrapperSession::init 的 C++ 伪代码（RVA 0x37186，
INTSessionShell vtable 槽位 16），定位 cpp_impl 赋值函数，并写出对应的
C++ IAT Hook 代码。
```

**常用 MCP 工具**：
- `decompile_function(0x180037186)` → init 伪代码
- `get_xrefs_to(addr)` → 谁调用 init / 谁构造 SessionConfig
- `search_functions_by_name("self-register")` → 环境自检点
- `/strings` → RTTI 类名 / 字段名 / 标记字符串

---

## 6. C++ Loader 模板构思（阶段二骨架）

```cpp
// 载具 DLL：绕过 self-register + 激活 cpp_impl + 无头（骨架，地址待 Ghidra 定位）
#include <windows.h>

// --- 阶段一 Ghidra 产出（占位，定位后填充）---
constexpr uintptr_t RVA_SELF_REGISTER_CHECK = 0x0; // self-register 校验跳转
constexpr uintptr_t RVA_CPP_IMPL_ASSIGN = 0x0;     // session cpp_impl 赋值函数

// IAT Hook（V1 已验证方案：改 slot 值，不碰代码段）
struct IatSlot { uintptr_t* iat; uintptr_t orig; };
static IatSlot g_hooks[8];
static int g_hookCount = 0;

// 1) NOP self-register 校验：定位后 patch 为 jmp 直通
static void bypassSelfRegister() {
    // 阶段一产出：RVA_SELF_REGISTER_CHECK 处 patch（VirtualProtect + memcpy）
}

// 2) 激活 session cpp_impl：调用赋值函数 or 伪造初始化信号
static void activateSessionCppImpl() {
    // 阶段一产出：构造参数 + 调用 RVA_CPP_IMPL_ASSIGN
}

// 3) 无头：阻断 BrowserWindow / GPU（宿主进程侧 Electron API 即可）
//    在宿主 JS 里 app.on('browser-window-created') destroy 窗口

BOOL WINAPI DllMain(HINSTANCE, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        bypassSelfRegister();
        activateSessionCppImpl();
        // CreateThread 引导 boot.cjs（复用 V1 hookdll 结构）
    }
    return TRUE;
}
```

---

## 7. 合规红线（V2 仍保留）

1. **零引入 NapCat 代码**（GPL-2.0 不兼容，含类型定义）。
2. **不修改 QQ 安装目录**（内存 patch，磁盘零改动）。
3. **载具源码私有**，公共仓库只放业务层 + 构建配置。
4. **逆向产物（Ghidra 分析）不提交公共仓库**，仅存私有。
5. 接口签名是外部系统事实（腾讯 wrapper.node），自研描述合法。

---

## 8. 下一步行动（给 AI IDE 的指令）

1. 读取 `docs/ghidra-mcp-guide.md`，启动 GhidraMCP 桥。
2. 用 `search_functions_by_name` / `/strings` 定位 "Module did not self-register"
   字符串的 xref → 确认 self-register 校验函数。
3. 用 `decompile_function(0x180037186)` 分析 `NodeIQQNTWrapperSession::init`，
   找 cpp_impl 赋值调用链。
4. 产出「RVA 定位表」→ 填充 C++ Loader 骨架的占位地址。
5. 用 LLVM-MinGW（V1 已用工具链）编译载具 DLL，跑冒烟测试。
