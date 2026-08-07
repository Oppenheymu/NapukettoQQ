# @napuketto/loader 设计

> 职责：**自建宿主引导**（2026-08-07 唯一路线）——标准 Node + stub QQNT.dll 转发宿主符号，
> `process.dlopen(wrapper.node)` → kernel 装配 → 登录 → session → 协议装配，全程不拉起 QQ / 不注入。
> **状态：定稿（2026-08-07）**。V1 注入框架 / V2 载具 / 路线 B 已全部归档 `archive/`（见 §5 历史演进），
> 本包不再编译任何 C++ 组件，业务层 100% 走 NAPI。

---

## 1. 现状：自建宿主唯一路线

**关键事实链（2026-08-05~07 实测，勿重复探索）**：
1. `wrapper.node` **不是标准 NAPI self-register 模块**：无 `nm_register_func`，纯 Node `process.dlopen`
   报 `Module did not self-register`；QQ 定制 Electron 的 preload 才能注册。
2. **QQNT.dll 是可独立加载的宿主桥接层**：导出全套 v8/node/napi 符号 + `qq_magic_napi_register`
   （wrapper.node 的常规导入，加载时硬依赖）。
3. **stub QQNT.dll 等价物**（自研，native 子仓库）：99 静态转发（napi_* → node.exe）+ PerfTrace 空实现，
   PATH 前置后标准 node 可 `process.dlopen(wrapper.node)`（98 exports）。
4. 自建宿主三要素：① stub QQNT.dll 转发（PATH 前置）② `NodeIO3MiscService.get()` + `addO3MiscListener`
   激活事件分发（否则 getLoginList 永不 resolve）③ commonPath/desktopGlobalPath = 数据根/nt_qq/global。
5. session READY 四步：登录成功 → `session.init(config, depends, dispatcher, listener)`
   → **`startupSession.start()`**（先 init 后 start！）→ 等 `onOpentelemetryInit(is_init=true)`。

**边界**：
- **做**：定位 QQ 安装 → PATH 前置 stub + resources\app → spawn 标准 node 跑 self-host.cjs → 引导 kernel。
- **不做**：DLL 注入、vtable / 内存偏移 / 结构体手写、修改 QQ 安装目录任何文件、WebUI。
- 逆向手段（Ghidra / probe）仅限理解机制，产物不进公共仓库（见 §4 红线）。

## 2. 目录结构（实然，2026-08-07 阶段 2 定稿：runtime TS 化 + tsdown 双构建）

```
packages/loader/
├── package.json            # @napuketto/loader（自建宿主引导，无 C++ 构建）
├── tsconfig.json
├── tsdown.config.ts        # 双构建：index（ESM+d.mts）+ host/self-host（CJS 单文件 bundle）
├── docs/design.md          # 本文件
├── src/                    # TS 编排层（tsdown 编译范围）
│   ├── index.ts
│   ├── locate-qq.ts        # 注册表/常见路径定位 QQ.exe + 版本目录
│   ├── launcher.ts         # 装配 env + PATH 前置 stub + spawn 标准 node（launchSelfHost）
│   └── host/               # 自建宿主引导运行时（2026-08-07 阶段 2 由 runtime/ TS 化）
│       ├── self-host.ts    # 入口：dlopen wrapper.node + O3MiscService 激活 + bootstrap
│       ├── bootstrap.ts    # 主编排：kernel 装配 → 登录 → session → 冒烟 → 协议
│       ├── login.ts        # 登录流程（选账号 / 快速登录 / QR 回退）
│       ├── session.ts      # session 候选收集 / 选择 / 就绪探测
│       ├── protocols.ts    # OB11 adapter + network 装配
│       ├── smoke.ts        # 收发冒烟自检（NAPUTO_SMOKE=1）
│       ├── util.ts         # 日志 + 共享状态（SharedState）
│       ├── env.ts          # 引导环境变量访问层（对象字面量快照）
│       └── types.ts        # kernel 最小交互面（KernelLike 等，自研描述）
├── native/                 # 闭源（Git Submodule，private：Oppenheymu/NapukettoQQ-Native）：stub 源码 / 验证脚本 / 工具 / 产物 / 逆向文档，见其 README
│   ├── stub/               # stub-qqnt.cpp/.def（唯一长期维护源码）
│   ├── verify/             # kernel-flow.mjs（回归验证）
│   ├── tools/              # compare-symbols.mjs（QQ 升级后重跑）
│   ├── build/              # QQNT-stub-full.dll + stub-test-env/（launcher 默认引用）
│   ├── docs/               # 逆向文档（ghidra-mcp-guide / HANDOVER-V11，2026-08-07 移入）
│   └── _archive/           # 历史实验
```

**构建（tsdown 双配置）**：`pnpm --filter @napuketto/loader build` →
`dist/index.mjs` + `dist/index.d.mts`（对外 API，ESM）+ `dist/host/self-host.cjs`
（引导运行时，CJS 单文件 bundle——rolldown 内联 host 依赖树，launcher spawn 直接执行）。
旧 `runtime/`（手写 JS）与 `scripts/build-runtime.mjs`（复制脚本）已删除，
构建收敛为单段 `tsdown`。

## 3. 与 kernel 的边界

- `loader` 依赖 `@napuketto/kernel`（src/host/self-host.ts → bootstrap.ts 里动态 import kernel 入口）。
- `kernel` **不依赖 loader**：kernel 只暴露「给定 NAPI exports 即可初始化」的纯函数（`createWrapper(exports)`）。
- `apps/cli` 依赖两者：编排「定位 QQ → launchSelfHost → 等待登录 → 常驻」。

## 4. 红线

- **绝对禁止**：koffi、vtable 槽位、手算内存偏移、memcpy 结构体、绕过 NAPI 的 thiscall（业务层）。
- **绝对禁止**：修改 QQ 安装目录（package.json / asar / 任何原生文件）——零磁盘篡改，升级/卸载零残留。
- **闭源红线**：逆向腾讯 QQ 的产物（RVA/Offset 表）绝不进公共仓库（源码/注释/文档都不行）；
  载具源码 `native/` 为 Git Submodule（private 仓库），公共仓库只留框架。
- 所有逆向（Ghidra / probe）仅用于理解机制，产物不进入正式代码。

## 5. 历史演进（已归档 archive/，仅供追溯）

### 5.1 V1 注入框架（2026-08-05，IAT hook）

背景：QQ 定制 Electron 禁 NODE_OPTIONS、wrapper.node 非标准 self-register → 必须 C++ 注入引导。
最终方案 v7 = **IAT hook**（改写 IAT slot 存的函数指针，不碰代码段 → 不触发 CFG）：4 hook 全装 →
`napi_set_named_property` 触发 → boot JS 执行 → 截获 89 exports → startNapuketto OK。
产物：`bootmain.cpp` / `hookdll.cpp`（注入框架）+ `runtime/boot.cjs`（dlopen 截获 + Proxy 捕获 session）
+ `stage.ts` / `smoke-test.mjs`（已随归档删除）。

### 5.2 V2 载具（2026-08-06，闭源）

背景：9.9.31 把 session 真实初始化下沉 C++ 层，主进程 JS 侧 `new` 拿到无 cpp_impl 空壳。
载具 DLL（`vehicle.cpp`，RVA 表闭源）主动创建 NTWrapperSession → 注册单例表 → 激活 cpp_impl。
**教训**：RVA 表针对 9.9.31 逆向，注入 9.9.33 会内存 patch 到错误地址 → QQ 0xC0000005 崩溃
（boot JS 未执行即崩）。此路径已被 §5.4 自建宿主取代，勿再用。

### 5.3 路线 B（2026-08-06，NapCat 同款）

链路：boot.cjs（NAPUTO_ROUTE_B=1）→ `electron.utilityProcess.fork(route-b-worker.cjs)`
（继承 QQ env，事件分发对象天然可用）→ worker 内 dlopen（无需 IAT 改写）→ bootstrap 复用。
**状态**：P2-0/P2-1 全通（冒烟收发通过），曾为兜底路线；2026-08-07 自建宿主复活后被淘汰。

### 5.4 自建宿主复活（2026-08-07，定稿）

**决定性突破（HANDOVER-V9）**：自建宿主（标准 node + stub QQNT.dll）session 业务 service 可激活——
关键 = `session.init(config)` 之后调 `startupSession.start()`（先 init 后 start！），
`onOpentelemetryInit(is_init=true)` 触发 → getMsgService READY（298 方法）。
隔离实验：O3 上报 / UUID guid / deviceConfig 均非必要。**路线 A 可救，产品路线主攻，路线 B 淘汰**。

**关键结论（勿重复探索）**：
- self-register：wrapper.node 无 `nm_register_func` → 标准 node 的 `process.dlopen` 硬查会失败，
  用 `LoadLibraryA` 绕过（模块进内存 + 常规导入自动绑定）——无需 NOP self-register。
- 登录：stub 转发 + O3MiscService 激活事件分发 + commonPath=nt_qq/global（三要素，见 §1）。
- session：**先 `session.init(config)` 再 `startupSession.start()`**（NapCat 顺序）。
- 等 `onOpentelemetryInit(is_init=true)` → getMsgService READY（298 方法）。

## 9. 自建宿主引导（路线 A，2026-08-07 产品化落地，实测全通）

> **背景**：HANDOVER-V6/V9 实证自建宿主可救（标准 node + 自研 stub QQNT.dll 转发 → 登录 +
> session READY）。本会话（2026-08-07）完成产品化落地：`NAPUTO_SELF_HOST` 分支 + kernel 四处
> 适配，**实测：登录 3567141148 → session READY（getMsgService 298 方法）→ 冒烟收发通过 →
> onebot11 adapter 启动**。

### 9.1 链路（标准 node，无 QQ 进程）

```
cli --self-host（或直接 node self-host.cjs）
  ├─ PATH 前置 stub QQNT.dll 目录 + QQ resources\app（launcher.launchSelfHost 装配）
  ├─ self-host.cjs：dlopen wrapper.node（stub 转发 napi_*/uv_* → node.exe，98 exports）
  ├─ NodeIO3MiscService.get() + addO3MiscListener  ← 🔑 激活事件分发（否则 getLoginList 挂起）
  ├─ bootstrap(state) 完全复用（src/host/bootstrap.ts：kernel 装配 → 登录 → session → 冒烟 → 协议）
  └─ 常驻（协议服务在事件循环上）
```

### 9.2 文件

- **`src/host/self-host.ts`**（2026-08-07 阶段 2 由 runtime/self-host.cjs TS 化）：自建宿主入口
  （dlopen + O3MiscService 激活 + bootstrap）。
- **`src/launcher.ts`**：`LaunchOptions.selfHost/stubDir/selfHostEntry` + `launchSelfHost()`
  （spawn 标准 node + PATH 前置 stub/resources\app）+ `ENV.SELF_HOST`。
- **`apps/cli`**：`--self-host` / `--stub-dir` 选项透传到 `runSingleAccount`。
- **src/host/bootstrap.ts**：自建宿主跳过 `collectCandidateSessions`（getMainSession 内部会先
  `startupSession.start()`——与「先 init 后 start」顺序冲突，V9 实测）。

### 9.3 kernel 适配（自建宿主实测发现，2026-08-07）

| 修复 | 说明 |
|---|---|
| `resolveQqGlobalPath` | commonPath/desktopGlobalPath = **数据根/nt_qq/global**（三要素之三；数据根本身 getLoginList 空） |
| loginService 优先 `get()` | `new NodeIKernelLoginService()` 实例读不到登录列表（自建宿主实测） |
| `ensureLoginConnected` | 快速登录前 `connect()` + 等 `onLoginConnected` + 3s 缓冲（无缓冲则「登录系统连接异常」） |
| 自建宿主 session 先建 | session（SSW.create + getNTWrapperSession）在 **engine init 之前**创建（p0-kernel-flow 决定性顺序，engine 先建 session 后建则 onOpentelemetryInit 不触发） |
| 网络错误判定扩展 | 「登录系统连接异常」并入可重试网络错误 |

### 9.4 运行（验证命令，闭源 stub 环境）

```powershell
cd packages\loader\native
$env:PATH = "stub-test-env;QQ\resources\app;" + $env:PATH
$env:NAPUTO_WRAPPER_PATH = "<QQ 版本目录>\resources\app\wrapper.node"
$env:NAPUTO_QQ_VERSION = "9.9.33-51802"
$env:NAPUTO_CFG_DIR = "<数据目录>"
$env:NAPKETTO_CONFIG = "<项目根>\napuketto.toml"   # 全局配置文件（2026-08-07 起在项目根）
$env:NAPUTO_KERNEL_ENTRY = "<kernel dist/index.mjs>"
$env:NAPUTO_ADAPTER_ENTRY = "<adapter dist/index.mjs>"
$env:NAPUTO_NETWORK_ENTRY = "<network dist/index.mjs>"
$env:NAPUTO_QUICK_UIN = "3567141148"   # 3054108135 账号风控勿用
$env:NAPUTO_SELF_HOST = "1"
$env:NAPUTO_SMOKE = "1"                # 冒烟收发自检
node packages\loader\dist\host\self-host.cjs
```

### 9.5 内存实测（下一步，P2-2 候选 A 验收）

标准 node + stub + wrapper + 登录态 + 协议装配 → 实测内存占用（目标百兆级，对照路线 B 300MB+）。

> **2026-08-06 注**：自建宿主（§3.2.1 架构书）验证后，注入 QQ 主进程降级为备选路线。
> vehicle.cpp 的激活链知识（FUN_180025d63/FUN_180025d9d/FUN_180028756）在自建宿主里
> 由 koffi 调用等价函数替代，载具 C++ 注入不再必需。
