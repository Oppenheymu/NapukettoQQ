# 交接：V2 逆向阶段（2026-08-06 起）

> **本文件专为「新对话只做逆向」交接**。新对话开场先读：
> 1. 本文件（交接要点）
> 2. `AGENTS.md`（V2 架构 + 红线已更新）
> 3. `docs/architecture-v2-native-bypass.md`（V2 架构书）
> 4. `docs/architecture-investigation.md`（9.9.31 排查结论）
> 5. `docs/ghidra-mcp-guide.md`（GhidraMCP 使用手册）
> 6. `/memories/session/qq931-session-debug.md`（调试细节）

---

## 1. 当前任务：阶段一 Ghidra 逆向定位

**目标（AGENTS.md 第 7 条 V2 架构）**：Native C++ Bypass 载具 + NAPI 业务层混合模式。
载具 DLL 三职责：① NOP self-register 校验 ② 激活 session `cpp_impl` ③ 阻断 UI/GPU 无头。

**本阶段（Ghidra 逆向）具体目标**：

| 优先级 | 目标 | 方法 | 产出 |
|---|---|---|---|
| P0 | self-register 校验点 | `/strings` 找 "Module did not self-register" → xref | NOP 目标地址 |
| P0 | `NodeIQQNTWrapperSession::init` 的 cpp_impl 赋值 | INTSessionShell vtable 槽位 16（RVA `0x37186` 候选）→ decompile | cpp_impl 激活函数地址 |
| P1 | 环境自检（napi_env/宿主校验） | xref napi_* 调用点 | bypass 清单 |
| P1 | Session 初始化信号（onOpentelemetryInit 触发链） | 找 is_init=true 赋值点 | 伪造信号方案 |

## 2. GhidraMCP 状态（重要：8080 未监听）

**已就绪**：
- Ghidra 12.1.2 → `C:\Dev\Tools\ghidra_12.1.2_PUBLIC\`
- 项目（wrapper.node 已全量分析）→ `C:\Dev\Tools\ghidra-project\NapukettoWrapper.gpr`
- 桥脚本 → `C:\Dev\Tools\GhidraMCP-1-4\GhidraMCP-release-1-4\bridge_mcp_ghidra.py`
- `.vscode/mcp.json`（本会话新创建，桥配置正确）
- Python 3.14.6

**当前卡点**：Python 桥在 8081 监听 ✅，但 **8080（Ghidra HTTP 服务）无监听** ❌
→ Ghidra GUI 里的 GhidraMCP 插件 HTTP 服务未启动。

**解决（用户手动）**：
1. `C:\Dev\Tools\ghidra_12.1.2_PUBLIC\ghidraRun.bat` 启动 Ghidra
2. `File → Open Project` → `C:\Dev\Tools\ghidra-project\NapukettoWrapper.gpr` → 双击 `wrapper.node`
3. `File → Configure → Developer → GhidraMCPPlugin` 启用（端口 `Edit → Tool Options → GhidraMCP HTTP Server` 默认 8080）
4. 若桥未跑：`python "...bridge_mcp_ghidra.py" --transport sse --mcp-host 127.0.0.1 --mcp-port 8081 --ghidra-server http://127.0.0.1:8080/`
5. VSCode `MCP: List Servers` 确认 ghidra 已连接

## 3. 关键 RVA 换算（ghidra-mcp-guide.md §RVA 换算）

- 运行时基址 = vtable 运行时 − vtable RVA = `0x7ffc046ec368 − 0x395e368` = **`0x7ffc00d8e000`**
- 函数 Ghidra 地址 = `0x180000000 + (运行时地址 − 0x7ffc00d8e000)`
- **init 候选**：INTSessionShell vtable 槽位 16，运行时 `0x7ffc00dc5186` → RVA `0x37186` → **`0x180037186`**

## 4. 已确认事实（勿重复探索，详见 architecture-investigation.md）

- 主进程 `new`/`create()`/捕获 session → 全 `getMsgService` 断言 cpp_impl 无效（9.9.31 主进程 JS 侧无有效 session）
- 渲染进程 `executeJavaScript` → contextIsolation 隔离，window 仅标准 DOM
- `RM_IPCFROM_RENDERER*` ntApi 分发器 → C++ 层（`[native code]`），JS 不可调
- **唯一出路**：C++ 载具激活 cpp_impl（Ghidra 定位赋值函数）→ 这就是本阶段任务

## 5. 红线（AGENTS.md 第 7 条 + V2 文档 §1）

1. **目的单一性**：逆向/Hook 仅限「阻断 UI/GPU 降内存 + 激活 cpp_impl」。
2. **业务逻辑零逆向**：收发消息/事件/解析 100% 走官方 NAPI JS 接口，C++ 层禁业务 Hook。
3. **零磁盘篡改**：内存 patch 仅 RAM 生效，禁改 QQ 安装目录二进制。
4. **零引入 NapCat 代码**（GPL-2.0 不兼容）。
5. **逆向产物（RVA 表/Offset）不提交公共仓库**，仅存私有。

## 6. 载具 C++ 骨架（阶段二填地址，见 V2 文档 §6）

- 复用 V1 `hookdll.cpp` 的 IAT Hook 机制（改 slot 值，不碰代码段，不触发 CFG）
- 复用 V1 `bootmain.cpp`（拉起 QQ + 注入 + WaitForSingleObject 等待退出）
- 新增强：bypassSelfRegister() + activateSessionCppImpl()（地址待 Ghidra 产出）
- 工具链：LLVM-MinGW g++（V1 已用，`scripts/build-native.mjs`）

## 7. 业务层现状（V2 不改业务代码）

- 78 个 OneBot 动作 + kernel 12 apis 全实现（HANDOVER.md 有详单）
- `kernel.NapukettoCore` / apis / adapter / boot.cjs 全复用
- 载具激活 session 后，boot.cjs 捕获有效 session → startProtocols 装配不变

---

## 9. 实机验证突破（2026-08-06 下午，激活链已跑通！）

### 9.1 激活链完整参数（已实证）

```
1. FUN_180025d63(&ret, &sessionIdStr)  → 创建 NTWrapperSession
   注意：sessionId 必须是 QQ std::string（32 字节 SSO 结构），不是 C 字符串！
   QQ std::string 布局（FUN_1806b0a90 逆向）：
     +0x00: char[16] buf（SSO 首字节 = len<<1，libstdc++ 风格）
     +0x10: size_t size
     +0x18: size_t capacity
2. cpp_impl = *(ret + 0x00)            → 对象指针（不是 +0x18！）
   FUN_180041236: MOV [RCX], RDX（对象存 param_1+0x0）
3. FUN_180025d9d(&sessionIdStr, ret)   → 注册进单例表
   注意：第 2 参是 shared_ptr 结构（16 字节 {对象指针, 控制块指针}），不是裸指针！
   FUN_18001650e 读 param_2[0]=对象, param_2[1]=控制块 → 传裸指针会 0xC0000005 崩溃
4. FUN_180028756(cpp_impl, sessionConfig) → init（sessionConfig 结构待逆，未调用）
```

### 9.2 实测结果（vehicle.log，QQ 存活 9 进程无崩溃）

```
✅ wrapper.node 已定位
✅ sessionIdStr size=7 cap=0 buf[0]=0x0e   （"Session" SSO 编码正确）
✅ NTWrapperSession 已创建, cpp_impl=0x0000027727679E18
✅ session 已注册（key=sessionId）
✅ cpp_impl 激活完成
```

### 9.3 实机踩过的坑（勿重复）

| Bug | 现象 | 修复 |
|---|---|---|
| sessionId 传 C 字符串 | 创建失败（ret+0x0 为空） | `QqString::fromCStr()` 构造 32 字节结构 |
| cpp_impl 偏移用 +0x18 | 取到空 | 改为 **+0x00** |
| 注册传裸指针 | **QQ 崩溃 0xC0000005**（code=3221225477） | 传 `ret`（shared_ptr 本体） |

## 10. 闭源边界（2026-08-06 用户拍板，已完成）

- 许可证 GPL-3.0 → **MIT**（根 LICENSE + 7 个 package.json 已改）
- 载具源码 `packages/loader/native-private/vehicle.cpp` → **.gitignore 排除**（本地/私有）
- 载具 DLL 编译+混淆后分发（.dll 二进制），源码不开源
- 公共仓库只留注入框架（bootmain/launcher/build-native 载具调用点，无逆向细节）
- `docs/` 整目录 gitignore（本文件不提交 git）
- RVA 表存于会话记忆（不在 git）

## 11. 遗留问题（下一步清单）

1. ~~**hookdll 偶发未注入**（时序竞态）~~ **✅ 已修复（2026-08-06）**：
   - 根因：injectDll 不检查 LoadLibraryA 返回值（CreateRemoteThread 成功≠DLL 加载），进程早期 LoadLibrary 失败但误报成功
   - 修复（bootmain.cpp）：① WaitForInputIdle(15s) 等主进程 GUI 初始化 ② GetExitCodeThread 校验 HMODULE ③ 重试式注入
   - 实测：连续 4 轮 hookdll 4/4 + vehicle 全成功
2. ~~**boot.cjs 未接上**~~ **✅ 已解决**：hookdll 稳定注入后 boot.cjs 执行（status=0，runtime/package.json 修 CJS 解析），登录成功 + session 替换链路通
3. **init 未调用（FUN_180028756 SessionConfig 待逆）——当前主要卡点**：
   - 尝试 1：boot.cjs JS 侧 `kernel.initAndStartSession`（session.init NAPI 转换）→ 20s 超时（完成信号依赖渲染进程/网络栈协作，主进程 JS 侧等不到）
   - 下一步：vehicle C++ 侧调 FUN_180028756 + SessionConfig 结构逆向（NapCat genSessionConfig 说明书 + Ghidra）；或补 kernel DependsAdapter/DispatcherAdapter
4. **无头方案修正**：boot.cjs 当前的 `destroy()` 窗口方案**不降内存**（渲染/GPU 进程不退出）
   - 正确方案：`--disable-gpu` + 阻断 `webContents` 创建（进程级阻断）
   - 依赖：cpp_impl 激活成功后 QQ 才不需要渲染进程（当前激活已成功 → 可做）
5. ~~**验证激活的 session 是否真有效**~~ **✅ 重大突破**：cpp_impl 激活**生效**——`getMainSession`（nt_x）与 `getNTWrapperSession("Session")` 均返回**有效对象**（getMsgService 可调不抛断言），不再 "implementation is not valid"；但 **service 未挂载（msgSvc=null）**，需 init 后 READY

## 12. 环境注意事项（实测）

- 终端 PowerShell 内建命令**间歇性失效**（Get-ChildItem/tasklist 等偶发 not recognized）→
  优先用 `read_file` 读日志，`Get-Process/Stop-Process` 相对稳定
- `Start-Process node apps/cli/dist/index.mjs` 后台启动可避免卡对话（重定向到 .smoke-out.txt）
- 日志位置：`C:\Users\xiaoxiaochen\.napuketto\default\`（vehicle/hookdll/boot）
- 停止测试：`Get-Process QQ,node | Stop-Process -Force`
- 数据目录有 7 个可快速登录账号（QQ 默认 3567141148）
