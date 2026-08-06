# @napuketto/loader 设计

> 职责：**把 Napuketto 业务代码引导进 QQ 定制版 Electron 主进程**，并从 `wrapper.node` 的 NAPI 注册中截获合法的 `module.exports`。这是 NapukettoQQ 的唯一 C++ 组件，但**只做注入与引导，绝不裸调 C++ ABI**。
> 对应路线：ADR 决策「路线 A（进程注入 Loader），排除路线 B（改 QQ package.json）」。
> **状态：2026-08-05 全链路实测打通**——注入 → IAT hook → boot JS → 截获 89 exports → startNapuketto OK（见 §5.1/§5.2）。

---

## 0. 为什么需要 C++ 组件（事实链，2026-08-05 实测）

1. `wrapper.node` **不是标准 NAPI self-register 模块**：PE 导入表为空（全延迟加载）、导出表 33 个符号全是 MSVC mangled 名、无 `nm_register_func`。
2. 纯 Node `process.dlopen` → `Module did not self-register`（实测失败）。
3. 普通 Electron v43 `process.dlopen` → 同样失败（实测）。
4. **QQ.exe（定制 Electron）能注册**：`[preload] succeeded. wrapper.node` / `[preload] register done. wrapper.node`（实测 QQ stdout）。
5. QQ 是打包应用，**Electron 禁用 NODE_OPTIONS**：`Most NODE_OPTIONs are not supported in packaged apps`（实测 stderr）——不能用 `NODE_OPTIONS=--require` 注入 JS。
6. QQ.exe 导出 `napi_module_register` 与 `uv_dlopen`（GetProcAddress 实测可拿）——注入方案的锚点。

结论：必须由 C++ hook DLL 注入 QQ 主进程，把 boot JS 引导进 Electron 运行时；业务层 100% 走 NAPI，不碰 C++ ABI。

## 1. 边界

- **做**：定位 QQ 安装目录 → stage 依赖 → 拉起 QQ.exe → 注入 hook DLL → hook DLL 引导 boot JS → boot JS 截获 wrapper.node exports 并启动 kernel。
- **不做**：任何 vtable / 内存偏移 / 结构体手写；不修改 QQ 安装目录任何文件（路线 B 封杀）；不做 WebUI。
- **C++ 只做两件事**：注入（DLL 进主进程）+ 引导（执行 boot JS）。其余全部是 TS/JS。

## 2. 目录结构

```
packages/loader/
├── package.json            # @napuketto/loader（含 C++ 构建脚本）
├── tsconfig.json
├── docs/design.md          # 本文件
├── native/                 # C++ 源码（自研，参考通用注入技术，非 NapCat 代码）
│   ├── CMakeLists.txt      # 或 Makefile（winlibs 兼容）
│   ├── bootmain.cpp        # NapukettoBootMain.exe：启动 QQ + 注入
│   ├── hookdll.cpp         # NapukettoWinBootHook.dll：注入后引导 boot JS
│   └── minhook/            # 可选：inline hook 依赖（MinHook 开源库）
├── src/                    # TS 编排层
│   ├── index.ts
│   ├── locate-qq.ts        # 注册表/常见路径定位 QQ.exe + 版本目录（复用 kernel wrapper-version）
│   ├── stage.ts            # stage wrapper.node 依赖到临时目录（DLL 搜索限制规避）
│   ├── launcher.ts         # 设置环境变量 + spawn QQ.exe + 注入 hook DLL
│   └── types.ts            # 引导参数（boot JS 路径、kernel 入口等）
├── runtime/                # 注入后运行的 JS（构建产物复制到 dist/native/runtime/）
│   ├── boot.cjs            # 入口：hook process.dlopen → 截获 exports → 调度 bootstrap
│   ├── boot-util.js        # 日志 + 共享状态
│   ├── boot-ipc-monitor.js # IPC 监控（V1 排查保留）
│   ├── boot-headless.js    # 无头模式（阻断 UI/GPU）
│   ├── boot-protocols.js   # 协议装配（OB11 adapter + network）
│   ├── boot-bootstrap.js   # kernel 引导 + 登录 + session 替换（V2 getMainSession/getNT）+ init
│   └── package.json        # {"type":"commonjs"}——项目根为 ESM，CJS 模块必须声明（2026-08-06 修复 status=9）
│   └── (kernel dist 由环境变量 NAPUKETTO_KERNEL_ENTRY 指向)
└── scripts/
    └── build-native.mjs    # 调 clang-cl/g++ 编译 C++ 产物到 dist/
```

## 3. 注入链路（自研方案）

```
apps/cli 启动
  → loader.launcher.ts：解析参数（QQ 路径、kernel 入口、配置目录）
  → stage.ts：wrapper.node + 私有依赖复制到临时目录（DLL 搜索限制）
  → 设置环境变量：
      NAPUKETTO_BOOT_JS  = runtime/boot.cjs 的绝对路径
      NAPUKETTO_KERNEL_ENTRY = kernel dist 入口（.mjs）
      NAPUKETTO_CFG_DIR   = 配置目录
  → spawn QQ.exe（继承环境变量）
  → bootmain.exe（C++）：等 QQ.exe 主进程就绪 → CreateRemoteThread + LoadLibraryA 注入 hookdll.dll
  → hookdll.dll（C++，DllMain）：
      a) 轮询 GetProcAddress(GetModuleHandleA(NULL), "napi_module_register") 直到非空（Electron node 就绪）
      b) 构造 napi_module 结构（nm_filename="napuketto_boot.node"），注册进 node 的 NAPI 注册表
      c) 用 node 模块加载机制触发 require("napuketto_boot.node") → 我们的 NAPI 初始化函数拿到 napi_env
      d) 初始化函数里 napi_run_script 执行 NAPUKETTO_BOOT_JS 内容（或 require boot.cjs）
  → boot.cjs（JS，运行在 QQ 主进程）：
      a) hook process.dlopen：filename 含 wrapper.node 时截获 module.exports
      b) 若 wrapper.node 已被 QQ preload 注册（C++ 层），轮询 require(wrapperPath) 拿 exports
      c) import(NAPUKETTO_KERNEL_ENTRY) 启动 kernel：engine.init → session.init → startNT → 事件/API
```

> 注：步骤 (c)「触发 require」的精确机制以实测为准——优先尝试 hook `uv_dlopen` 让 node 走标准 NAPI 加载路径；备选是 inline hook `GetProcAddress` 拦截 `nm_register_func` 查询。详见 §5「待实测」。

## 4. 与 kernel 的边界

- `loader` 依赖 `@napuketto/kernel`（runtime/boot.cjs 里 import kernel 入口）。
- `kernel` **不依赖 loader**：kernel 只暴露「给定 NAPI exports 即可初始化」的纯函数（`createWrapper(exports)`）。
- `apps/cli` 依赖两者：编排「定位 QQ → 注入 → 引导 → 等待登录」。

## 5. 待实测项（C++ 工具链就绪后逐项验证）

- [x] hookdll 能否拿到 QQ.exe 主进程句柄并注入成功（**✅ v7 实测通过**）
- [x] `napi_module_register` 注册自研模块后如何触发 require（**✅ v7 改为 IAT hook，实测触发**）
- [x] boot.cjs 截获 wrapper.node exports 的时机与完整性（**✅ 实测截获 89 个 exports**）
- [x] engine.initWithDeskTopConfig 在 NAPI 下的真实调用（**✅ startNapuketto OK, engine=object**）
- [x] session.init 4 参（config / depends / dispatcher / listener 均为 TS 对象）（**✅ session=true**）
- [ ] 登录握手（ticket 获取 + session.init 真实凭据）
- [ ] service 获取（getMsgService 等）与事件回调

### 5.1 注入方案演进（2026-08-05 实测，最终 v7 = IAT hook）

**关键事实**：QQ.exe 的 `napi_*` 导出是 **delay-load stub**（`cmp [slot],0; jz helper; jmp [slot]`），slot 是 IAT 项，存真实函数指针，首次调用前为 0。inline hook stub 不可行（含分支搬移会崩）。

**方案演进**：
- v1 注册 napi_module 无触发机制 → 死路
- v2 hook `napi_run_script` 未被调用（QQ 9.9.31 字节码化不走它）
- v3 5 个 hook 自递归 → trampoline RIP 相对寻址崩（栈溢出 0xc00000fd）
- v4 修复签名但 boot 拿不到 exports
- v5 hook `napi_module_register` 但 stub 搬移崩
- v6 `FF 25` 解析成 slot 地址（应读值）→ 全 00 无效
- **v7（最终）**：**IAT hook**——改写 IAT slot 存的函数指针（不碰代码段 → 不触发 CFG）。slot 未初始化时登记后台轮询，delay-load 填充后改写。实测：4 hook 全装 → `napi_set_named_property` 触发 → boot JS 执行 → 截获 89 exports → kernel startNapuketto OK。

**boot.cjs 截获机制（最终）**：hook `process.dlopen` + 轮询，实测 `process.dlopen(m, wrapperPath)` 在 QQ preload 已注册后**能命中 module 缓存**拿到 exports（89 个）——无需 C++ 侧手动生成。

### 5.2 成功日志存档（2026-08-05）

```
hookdll.log: 4 IAT hook 安装 → napi_set_named_property -> env → boot JS 已执行, status=0
boot.log: CAPTURED wrapper.node exports (89) → bootstrap: startNapuketto OK, engine=object, session=true
QQ 6 进程全部 Responding（无崩溃无卡死）
```

## 6. 依赖方向更新（写进根 AGENTS.md 第 2 条）

```
@napuketto/kernel    无内部依赖（仅 pino）
@napuketto/media     无内部依赖
@napuketto/network   无内部依赖
@napuketto/adapter   kernel + network + media
@napuketto/loader    kernel（boot 引导）+ 无其他
apps/cli             kernel + adapter + loader
```

## 7. 红线重申

- **绝对禁止**：koffi、vtable 槽位、手算内存偏移、memcpy 结构体、绕过 NAPI 的 thiscall。
- **绝对禁止**：修改 QQ 安装目录（package.json / asar / 任何原生文件）。
- **允许**：DLL 注入、环境变量、临时目录 stage（都是运行时行为，不污染宿主安装）。
- 所有逆向（Ghidra / probe）仅用于理解机制，产物不进入正式代码。

---

## 8. V2 载具模式（2026-08-06，闭源组件）

> **背景**：QQ 9.9.31 把 session 真实初始化下沉到 C++ 层，主进程 JS 侧 `new`/`create()`
> 拿到的 `NodeIQQNTWrapperSession` 全是**无 cpp_impl 的空壳**（构造函数 `napi_wrap` NULL）。
> Ghidra 逆向已定位「创建有效 session」的导出链，载具 DLL 借此**主动创建并激活** session。

### 8.0 路线 B 定稿（2026-08-06，P2-0 全通）

> **用户拍板**：路线 B（NapCat 同款：注入 QQ 主进程 → utilityProcess Worker）全链路验证通过，
> 取代路线 A（自建宿主 + env 兼容层，P0-B 判死）。详见 `docs/HANDOVER-V5-route-b.md`。

**链路**：boot.cjs（NAPUTO_ROUTE_B=1）→ `electron.utilityProcess.fork(route-b-worker.cjs)`
（继承 QQ env，事件分发对象天然可用）→ worker 内 `process.dlopen(wrapper.node)`（98 exports，
无需 IAT 改写）→ boot-bootstrap.js 复用（kernel 装配 → 登录 → session → 协议装配）。

**P2-1（2026-08-06）launcher 默认开启路线 B**：`LaunchOptions.routeB`（默认 true）→ env
`NAPUTO_ROUTE_B=1`。cli 默认走 worker 模式（V1 主进程直接引导仅作历史回退，`routeB: false` 关闭）。

**⚠️ vehicle 注入修复（2026-08-06）**：路线 B（worker）**不注入 vehicle**——worker 继承 QQ env，
`getNTWrapperSession("nt_1")` 天然带 cpp_impl（P2-0 实测），无需 vehicle 激活 session。vehicle 仅
`routeB: false`（V1 主进程引导）时注入。**实测教训**：vehicle 的 RVA 表针对 9.9.31 逆向（闭源），
注入 9.9.33 会内存 patch 到错误地址 → QQ 0xC0000005 崩溃（boot JS 未执行即崩，日志无新条目）。
无头职责由 bootmain 命令行参数（NAPUTO_QQ_ARGS）+ boot-headless.js（JS 侧 Electron API）承担，
vehicle 的 C++ 阻断在路线 B 下不再需要。

**P2-1 冒烟自检（runtime/boot-smoke.js）**：`NAPUTO_SMOKE=1` 时，登录 + session 就绪后执行
业务层最后试金石——MsgBridge 注册 → 订阅 onRecvMsg → MsgApi.sendMessage（NAPUTO_SMOKE_PEER
指定目标，缺省发给自己）→ fetchMessages 落库核对 → 日志输出结论。build-native 已整目录拷贝
runtime/（含新文件），无需改构建脚本。

### ⚠️ 闭源红线（2026-08-06 用户拍板）

- **逆向腾讯 QQ 的产物（RVA/Offset 表）绝不进公共仓库**（含本文档、源码、注释）。
- 载具源码 `native-private/vehicle.cpp` 由 `.gitignore` 排除，**本地保留/私有仓库**。
- 载具 DLL **编译 + 混淆**后分发（.node/.dll 二进制），源码不开源。
- 公共仓库只保留**注入框架**（bootmain/launcher/build-native 的载具调用点，不含逆向细节）。
- 本文档只写**机制描述**，具体地址见私有逆向文档（不在 git）。

### 8.1 载具机制（私有 RVA 表见私有文档）

**激活链（机制）**：
1. 创建：导出工厂 make_shared 创建 `NTWrapperSession`（6 vftable 多继承）
2. 注册：把 session 注册进全局单例表（TLS 懒初始化容器，元素 0x48 字节）
3. 取 cpp_impl：容器查找后从「元素 + 0x38」偏移取（shared_ptr 槽位）
4. init：`NTWrapperSession::init` 接收 SessionConfig 初始化内部组件

**激活流程（目标）**：
```
创建 NTWrapperSession → 注册进单例表 → 取有效 cpp_impl 指针
  → napi_wrap 绑定到 NodeIQQNTWrapperSession JS 对象
  → init 完成初始化
  → 业务层 boot.cjs 捕获该有效 session（Proxy 机制不变）
```

### 8.2 self-register 结论（P0-1 修正 + 2026-08-06 突破）

- ❌ wrapper.node **无** "Module did not self-register"（该错误来自 node/宿主侧）
- ✅ **决定性发现**：`qq_magic_napi_register` 是 wrapper.node 对 **QQNT.dll 的常规导入**
  （Import Table，非 delay-load）——wrapper.node 加载时硬依赖 QQNT.dll 的该导出
- ✅ **QQNT.dll 是可独立加载的宿主桥接层**：导出全套 v8/node/napi 符号
  （`Isolate@v8`、`AsyncResource@node`、`napi_*`、`qq_magic_napi_register`）
- ✅ **自建宿主路线已实测验证**（标准 Node v24.16.0）：
  `LoadLibrary(QQNT.dll)` + `LoadLibrary(wrapper.node)` + koffi 调用
  `CreateNTSessionShell("Session")` **成功返回真实对象**（`0x1faef126030`）
- ✅ **无需 NOP self-register**：标准 Node 的 `process.dlopen` 硬查 `nm_register_func`
  （wrapper.node 没有）→ 用 **`LoadLibraryA` 绕过**（模块进内存 + 常规导入自动绑定）
- **结论：P0-1 彻底关闭**。自建宿主无需 bypassSelfRegister()，唯一前提是
  QQNT.dll + `resources\app` 依赖 DLL 可被搜索（SetDllDirectory + PATH）

### 8.3 载具 DLL 职责（`native-private/vehicle.cpp`，闭源）

```
1. 注入后（复用 hookdll IAT hook 机制进入 QQ 主进程）
2. 解析阶段一地址（RVA 换算：运行时基址 + RVA，私有表）
3. bypassSelfRegister()：占位（注入路线不需要；自建宿主用 LoadLibraryA 绕过，也不需 NOP）
4. activateSessionCppImpl()：创建 session → 注册单例 → 激活 cpp_impl
5. 无头：阻断 BrowserWindow / GPU（宿主 JS 侧 Electron API）
6. 引导 boot.cjs（复用 hookdll 现有 IAT hook 链）
```

> **2026-08-06 注**：自建宿主（§3.2.1 架构书）验证后，注入 QQ 主进程降级为备选路线。
> vehicle.cpp 的激活链知识（FUN_180025d63/FUN_180025d9d/FUN_180028756）在自建宿主里
> 由 koffi 调用等价函数替代，载具 C++ 注入不再必需。
