# NapukettoQQ 架构书（2026-08-06 合并定稿）

> **状态**：本文件是唯一架构书，合并自旧 `architecture.md`（总体架构）+ `architecture-investigation.md`
> （9.9.31 排查）+ `architecture-v2-native-bypass.md`（V2 决策书），并按 2026-08-06 路线修正
> （自建宿主可救 + 路线 B 兜底，详见 `docs/STATUS.md` 顶部决策点）。
> **配套**：`docs/STATUS.md`（现状 + 下一步）、`docs/DECISIONS.md`（决策史）、各包 `docs/design.md`。
> 新对话先读 STATUS → AGENTS.md → 本文件 → 对应包 design.md。

---

## 1. 项目定位

NapukettoQQ 是基于 **QQ NT 架构客户端**的机器人框架：

- 通过 QQ 原生模块 `wrapper.node` 把 QQ 内部 C++ 服务包装成语义化 API。
- 对外提供 **OneBot 11**（当前）协议接口（HTTP / WebSocket）；**Satori**（规划）。
  **OneBot 12 已放弃**（2026-08-05 用户拍板：规范过于模糊，commit ac5ebba 删除占位）。
- **永远不做 WebUI**；**不做 framework 模式**（QQNT 插件形式），只做独立进程/宿主模式。
- **全局配置 = 单一 TOML**：`<数据根>/napuketto.toml`（主配置段 + `[onebot11]` 协议段，
  cli 读写 + zod 校验，seed 注入 kernel ConfigBase）。

## 2. 包结构与依赖方向（只允许向下依赖）

```
apps/cli               启动编排（commander + 登录渲染 + 配置命令 + supervisor 多账号）
  └─ @napuketto/adapter   协议适配器容器（core 框架 + onebot11/satori）
       ├─ @napuketto/kernel   唯一原生交互层（wrapper / apis / 事件通道 / 缓存）
       ├─ @napuketto/network  协议无关传输层（HTTP / WS / 泛型广播）
       └─ @napuketto/media    媒体转码（silk / ffmpeg / 文件识别）
       （loader 仅被 cli 依赖，kernel 不依赖 loader；loader 依赖 kernel）
```

依赖方向硬约束（AGENTS.md 第 2 条）：
```
@napuketto/kernel    无内部依赖（仅 pino + smol-toml）
@napuketto/media     无内部依赖
@napuketto/network   无内部依赖（协议无关传输原语）
@napuketto/adapter   kernel + network + media（协议适配器容器）
@napuketto/loader    kernel（boot 引导）+ 无其他（唯一 C++ 组件：注入 + 引导 + Native Bypass 载具）
apps/cli             kernel + adapter + loader
```

## 3. 分层原则

| 层 | 职责 | 红线 |
|---|---|---|
| **kernel** | 唯一原生交互层 + 唯一共享状态层 | 其他包禁止直接触碰 `wrapper.node` / session / 原生 listener；kernel 无全局单例（ADR-015 推论，CoreContext 实例化持有） |
| **network** | 协议无关的传输原语（HTTP/WS + 泛型广播） | 禁止 import 任何协议包；事件类型泛型化 |
| **adapter**（协议容器） | 协议语义：事件模型、action 注册表、数据翻译、ID 映射 | 只认识 kernel 的 API/事件/缓存，不认识原生 |
| **media** | 媒体编解码与识别 | 只被协议层依赖；kernel 不背媒体依赖 |
| **loader** | 注入引导 + Native Bypass 载具（C++） | 逆向手段仅限此层；载具闭源（native-private） |
| **cli** | 启动编排、登录渲染、配置命令 | 不写业务逻辑，只装配 |

## 4. 技术路线（V2 定稿：Native Bypass 混合模式 + 自建宿主修正）

### 4.0 当前定稿（2026-08-06）

> **⚠️ 关键决策点**：自建宿主（标准 Node 纯 Node 模式）**按「可救」规划**（NapCat 纯 Node 模式
> ~237MB 能登录实证），路线 B（注入 300MB）为兜底。详细背景 + 验证实验见 `docs/STATUS.md` 顶部。

| 路线 | 形态 | 内存 | 状态 |
|---|---|---|---|
| **A. 自建宿主（唯一路线，2026-08-07 用户拍板）** | 标准 Node + stub QQNT.dll 转发（napi_* → node.exe）+ O3MiscService 激活 | ~100MB（待实测） | ✅ 登录 + session READY + 冒烟收发 + onebot11 装配，cli 默认（pnpm start） |
| **B. 注入 utilityProcess Worker**（NapCat 同款） | 注入 QQ 主进程 → worker dlopen | 300MB+ | ❌ **已淘汰（2026-08-07 用户拍板）**，launchQqWithLoader 仅历史回退 |
| C. V1/V2 主进程注入 | — | 1.01GB | ❌ 已排除 |

> **2026-08-07 用户拍板**：只保留自建宿主实现方式（NapCat 同款纯 Node 模式），路线 B
>（拉起 QQ + 注入）淘汰。cli `pnpm start` 默认走自建宿主（`launchSelfHost` → self-host.cjs）。

### 4.1 混合模式总览（两路线共用）

```
┌─────────────────────────────────────────────────────────────┐
│  业务层（开源，JS/NAPI）                                        │
│  pnpm monorepo：kernel / adapter / network / media / cli       │
│  通过纯 NAPI 调用 wrapper.node 业务 API（getMsgService 等）      │
├─────────────────────────────────────────────────────────────┤
│  载具层（私有，C++ Native，@napuketto/loader）                  │
│  ① NOP wrapper.node 环境自检与 self-register 校验               │
│  ② 激活 session 的 cpp_impl（伪造 C++ 层初始化信号，路线 B 用不上）│
│  ③ 阻断 Chromium UI / GPU / Renderer（无头 + 低内存）            │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 路线 B 链路（❌ 已淘汰，2026-08-07 用户拍板；仅历史回退）

```
pnpm start（apps/cli）——2026-08-07 起 cli 默认走自建宿主（4.3），不再走本链路
  └─ NapukettoBootMain.exe 拉起 QQ.exe + 注入 NapukettoWinBootHook.dll（自研 V1 资产）
  └─ hookdll IAT hook → 引导 boot.cjs（NAPUTO_ROUTE_B=1 分支）
  └─ boot.cjs fork utilityProcess Worker（继承 QQ env）→ route-b-worker.cjs
       └─ worker 内 process.dlopen(wrapper.node) → exports 98 个（QQ env 原生，无需 IAT 改写）
       └─ boot-bootstrap.js 复用 → kernel 装配 → 登录（快速/QR）→ session → 协议装配
  └─ 无头：阻断 UI/GPU/Renderer（vehicle.cpp）；主进程保留但无窗口
```

### 4.3 自建宿主链路（验证成功后，主攻目标）

```
标准 Node 自建宿主进程（无 QQ 进程，~100MB）
  ├── LoadLibrary(QQNT.dll)      → 提供 v8/node/napi/qq_magic 全套宿主符号（可独立加载，已实证）
  ├── LoadLibrary(wrapper.node)  → 常规导入自动绑定，绕过 Node self-register 检查
  ├── 建 Base_PowerMessageWindow（QQ 窗口类，QQNT.dll 内部依赖窗口消息循环）← 待验证
  ├── process.dlopen(wrapper.node)（IAT hook GetProcAddress 拦 napi_register_module_v1 查询）
  └── 已有票据登录 → session → 业务层 NAPI 复用（kernel/adapter 零改动）
```

**napi2native 真实职责（实证，非 env 兼容层）**：进程名伪装 QQ.exe、隐藏注入模块
（K32EnumProcessModules/GetModuleHandleW hook）、内存 RWX→RX 伪装、创建 `Base_PowerMessageWindow`
窗口类、数据包层 hook（Frida Gum，可选）。自研等价物需覆盖前 4 项。

### 4.4 关键实现认知（勿重复探索）

- **wrapper.node 无标准 NAPI 注册函数**（导出表仅 33 个 MSVC mangled 符号）：
  `qq_magic_napi_register` 是对 QQNT.dll 的**常规导入**（非 delay-load）；delay-load 表只有
  avif_convert/QBar/opencv/LightQuic/ncnn。`Module did not self-register` 来自标准 Node 的
  DLOpen 检查 `napi_register_module_v1`——QQ 定制 Electron 不查，走 `qq_magic_napi_register`。
- **QQNT.dll = 可独立加载的宿主桥接层**：导出全套 `napi_*` + v8 `Isolate` + node `AsyncResource` +
  `qq_magic_*`；导入仅系统 DLL + ffmpeg.dll。
- **session 创建（NapCat 方式，路线 B 实测）**：`StartupSessionWrapper.create()` →
  `getNTWrapperSession("nt_1")`（带 cpp_impl）→ `startupSession.start()`；
  **不要 `new NodeIQQNTWrapperSession()`**（cpp_impl 断言失败）。
- **initConfig 必须 `externalVersion: false`**（扫码兼容）；appid 每版本从 major.node
  `QQAppId/` 标记提取（9.9.33-51802 = 537376818）。
- **init 完成信号**：`onOpentelemetryInit(is_init===true)` 为主，`onSessionInitComplete(0)` 为辅。

## 5. 核心数据流

### 5.1 调用链（第三方 → QQ）

```
第三方框架 --POST/WS--> network 传输层
  --> adapter 协议适配器（zod 校验）
  --> adapter api 聚合（读 kernel 缓存，缺则调 API）
  --> kernel apis（统一错误语义：成功返业务值 / 失败抛类型化 KernelError）
  --> wrapper.node 原生服务
```

### 5.2 事件链（QQ → 第三方）

```
wrapper.node 原生回调
  --> kernel event-channel（每个 Service 只注册一次原生监听）
      ├── kernel 内部订阅：缓存主动维护（GroupCache 等）
      └── onebot 订阅：翻译为 OB11 事件（只读缓存，纯函数）
          --> network EventBroadcaster 广播给所有 HTTP/WS 适配器
```

## 6. 关键设计决策（ADR 摘要，已按 2026-08-06 修正）

完整背景见各包 `docs/design.md`。

| # | 决策 | 否决了什么 | 理由 |
|---|---|---|---|
| ADR-001 | **许可证 MIT，零引入 NapCat 代码** | 移植 NapCat 类型/实现（GPL-2.0-only 与 MIT 不兼容） | 法律干净；接口签名是外部系统事实，可自研描述 |
| ADR-002 | **network 协议无关，adapter 依赖 network** | NapCat 的传输层绑定 OB11 类型 | 为 Satori 复用传输层 |
| ADR-003 | **类型化事件通道**（EventEmitter + 从 Listener 接口推导签名） | NapCat 的 Proxy + any 老事件系统 | 编译期类型安全；每个 Service 只注册一次原生监听 |
| ADR-004 | **不做 framework 模式** | QQNT 插件运行方式 | 已被证明低效，只做独立进程/宿主模式 |
| ADR-005 | **不做 webui；配置走 CLI + 单一 TOML** | 管理面板；独立 JSON 配置 | 错误决策；JSON 门槛高，TOML 统一配置 |
| ADR-006 | **类型层来自运行时探测** | 拍脑袋或抄别家类型 | 加载 wrapper.node 后反射摸清 API 面（探测脚本放 kernel/scripts/probe） |
| ADR-007 | **文件日志用 pino** | log4js（NapCat 方案） | 结构化、性能好、内置 redact |
| ADR-008 | **缓存主动同步 + 只读消费** | NapCat 散落缓存 + 翻译时实时查 API | 翻译层纯函数、无副作用、可并行 |
| ADR-009 | **apis 统一错误语义** | 原生 `{result, errMsg}` 透传 | 协议层错误码映射各写各的，共享同一套错误语义 |
| ADR-010 | **登录状态机在 kernel，渲染在 cli** | 登录逻辑混在启动脚本 | 可单测、可复用；cli 只渲染二维码 |
| ADR-011 | **media 严格解耦** | NapCat 把媒体工具放 common/utils | kernel 不背 ffmpeg/silk 依赖 |
| ADR-012 | **ConfigBase 在 kernel（TOML），协议 schema 在协议包** | 协议配置 schema 进 kernel | 协议语义属于各协议包 |
| ADR-013 | **协议适配器统一进 adapter 包（core 框架 + onebot11/satori）** | 每个协议一个平级包、翻译各写各的 | 适配器骨架只写一次，协议只需薄映射层 |
| ADR-014 | **adapter 子路径导出（subpath exports）** | 单入口聚合全部协议 | cli 只依赖用到的协议；tree-shaking 友好 |
| ADR-015 | **多进程多账号，cli 编排** | 单进程多账号 | wrapper 多 session 共存未验证；进程天然隔离；kernel 无全局单例 |
| ADR-016 | **数据目录按账号隔离，放用户目录** | 数据放程序目录 | 程序目录可能只读；多账号天然分离 |
| ADR-017 | **KernelError 类型化错误 + 协议层映射表** | 原生 `{result, errMsg}` 透传（细化 ADR-009） | 错误分类在 kernel 只做一次 |
| ADR-018 | **wrapper 版本探测独立模块（wrapper-version）** | 硬编码版本路径 | appid/qua 与版本强相关（每版本从 major.node 解析） |

## 7. 路线图（现状修正，2026-08-06）

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P0 地基** | 类型层 + paths/config/logger/event-channel + errors/wrapper-version | ✅ 完成 |
| **P1 登录** | wrapper-version → engine init → QR/快速登录 → CoreContext + selfInfo | ✅ 完成（含网络重试） |
| **P2 消息链路** | apis/msg 收发 + adapter 订阅 + OB11 翻译 + network 广播 + send_msg | ✅ 完成 |
| **P3 OB11 补全** | 群管/好友/文件/资料/系统 动作 + notice/request/meta 事件 + HTTP 上报 | ✅ 完成（78 动作，对齐度 ≈70%） |
| **P4 扩展** | 合并转发、翻译、在线状态、media 接入、api 聚合、GroupCache | ✅ 完成 |
| **P5 多协议** | satori 协议适配器（adapter 包内新目录，复用 core 框架） | ⏳ 规划（onebot12 已放弃） |
| **P6 多账号** | cli 子进程编排（supervisor） | ✅ 代码完成（实测待补） |
| **路线验证** | 自建宿主验证实验（P2-2 第一优先）→ 无头/低内存验收 | 🔥 下一步 |

> P5 之后 webui 永远不在路线图上。

## 8. 红线与合规（AGENTS.md 第 7 条，两路线都适用）

1. **允许必要逆向（2026-08-06 用户拍板：非 0 逆向）**：环境模拟/反风控（进程名伪装、模块隐藏
   K32EnumProcessModules/GetModuleHandleW、内存 RWX→RX、窗口类）、数据包层 hook（Frida Gum 等价物）、
   无头阻断均可逆向。技术手段不设限（koffi / vtable 槽位 / 内存偏移 / thiscall 裸调）但**仅限
   loader 载具层**。
2. **业务层优先 NAPI（优先级而非禁令）**：收发消息/事件监听/数据解析优先走官方 NAPI 导出接口
   （稳定、简单、可维护）；仅当 NAPI 无法覆盖的能力（数据包层、环境模拟）才用 C++ 逆向补足。
3. **零磁盘篡改**：内存 Patch 仅在运行期 RAM 生效，严禁修改/覆盖 QQ 安装目录任何二进制。
4. **逆向产物管理**：Ghidra 分析（RVA 表/Offset）不提交公共仓库，仅存私有；`native-private/` 只分发
   编译+混淆二进制。
5. **零引入 NapCat 代码**（GPL-2.0 / Limited Redistribution License 与 MIT 不兼容；napi2native 闭源）。

## 9. 工具链

### 9.1 逆向分析（仅在需要时，路线 B 已无需）

- Ghidra 12.1.2（`C:\Dev\Tools\ghidra_12.1.2_PUBLIC\`）+ GhidraMCP 1.4（`C:\Dev\Tools\GhidraMCP-1-4\`）
- 项目：`C:\Dev\Tools\ghidra-project\NapukettoWrapper.gpr`（wrapper.node 已全量分析）
- 用法见 `docs/ghidra-mcp-guide.md`（保留）
- **⚠️ 2026-08-06 更新**：路线 B（worker 继承 QQ env）**不需要**激活 session cpp_impl——vehicle 注入
  已停用（`5ed694d`：9.9.33 RVA 表过期致崩溃）。Ghidra 主要留给「自建宿主复活」的窗口类/napi2native
  自研等价物研究。

### 9.2 C++ 载具构建

- LLVM-MinGW g++（`scripts/build-native.mjs`，PATH 前置 g++ 目录防 PowerShell PATH 失效）
- 载具源码：`packages/loader/native/`（公共注入框架）+ `packages/loader/native-private/`（闭源）

### 9.3 环境事实

- QQ 9.9.33-51802：`C:\Dev\QQBot-Dev\QQNT\`（wrapper.node 114MB，exports 98 个）
- QQ 登录数据：`C:\Users\xiaoxiaochen\Documents\Tencent Files\`
- NapCat 参考部署包：`C:\Dev\NapCat.Shell.Windows.Node1`（纯 Node 模式实证 ~237MB）
