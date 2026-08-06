# 交接：最终产品形态与路线定稿（V4，2026-08-06 深夜 v2）

> **本文件是产品最终形态 + 技术路线定稿交接**。新对话开场先读：
> 1. 本文件（最终目标 + 双层路线，最重要）
> 2. `docs/HANDOVER-V3-selfhost.md`（自建宿主可行性 + P0 bypass 实验结论）
> 3. `AGENTS.md`（V2 架构 + 红线）
> 4. `docs/architecture-v2-native-bypass.md`（V2 架构书）
> 5. `docs/HANDOVER-V2-reverse.md` + `docs/HANDOVER.md`（背景参考）
> 6. `/memories/session/selfhost-bypass-p0.md`（P0 实验结论）

---

## 🏆 最终产品形态（用户 2026-08-06 深夜定稿）

> **在项目目录 `pnpm start` → 控制台显示二维码 → 扫码登录 → 正常运行。**
> **全程不弹 QQ 窗口；内存百兆以内（尽力目标，可放宽到 300MB 级别）。**

验收标准 4 条：
1. 一键启动：`pnpm start`（项目目录，cli 入口）
2. 扫码登录：控制台二维码（无需任何 GUI 交互）
3. 全程无头：不弹 QQ 窗口
4. 低内存：**百兆以内为尽力目标，不是硬约束**（2026-08-06 用户明确放宽）

---

## 1. 双层路线策略（用户拍板）

> **先试「自建宿主 + env 兼容层」（优先）；验证失败则回退「NapCat 同款」（兜底）。**
> 「百兆」是目标不是死刑，NapCat 同款（300MB 级别）可接受。

| 路线 | 业务层 | 无头 | 内存 | 状态 |
|---|---|---|---|---|
| **A. 自建宿主 + env 兼容层**（标准 Node + QQNT.dll，无 QQ 进程） | NAPI（若 env 兼容层成功） | ✅ 彻底无 QQ | ~100MB 可达 | **优先尝试**（P0-A/B 验证） |
| **B. NapCat 同款**（注入 QQ 主进程 → utilityProcess Worker） | NAPI 全免费 | ⚠️ 有 QQ 主进程无 UI | 300MB+ | **兜底**（P0-A/B 失败则用） |
| ~~C. V1/V2 注入~~ | NAPI | ⚠️ | 1.01GB 实测 | ❌ 已排除 |
| ~~D. 自建宿主 + koffi 业务层~~ | koffi/vtable | ✅ | ~100MB | ❌ **违反红线**（AGENTS.md 绝对禁止 koffi/vtable 业务层） |

**关键纠正（v2）**：上一版 V4 曾写「自建宿主业务层走 koffi C++ ABI」——**这是错误的**，直接违反 AGENTS.md 红线（第 35 行：绝对禁止 koffi、手算 vtable 槽位、内存偏移/memcpy 结构体、绕过 NAPI 的 thiscall 裸调）。v2 已删除该路线，自建宿主业务层必须走 **NAPI**（env 兼容层方案），兜底走 NapCat 同款（QQ 主进程内 NAPI）。

---

## 2. 路线 A：自建宿主 + env 兼容层（优先尝试）

### 2.1 思路（对比 NapCat）
- **NapCat Shell**：Master = QQ 主进程（BootMain 拉起 QQ.exe + 注入）→ utilityProcess Worker 继承 QQ env → NAPI 全免费。代价：QQ 主进程 300MB+
- **我们**：去掉 QQ 主进程，标准 Node 直接加载 QQNT.dll + wrapper.node。但 NAPI exports 需要 QQ 定制 env（P0 已证标准 Node env 不兼容 → 0xC0000005）
- **env 兼容层**：改写 wrapper.node 的 napi_* IAT 槽 → 标准 Node env 函数表，让 env 与函数实现匹配 → exports 可构造 → 业务层全走 NAPI（与 NapCat 同款）

### 2.2 已实测的基础（勿重复探索）
```
标准 Node v24.16.0（无 QQ 进程）
  └─ LoadLibrary(QQNT.dll)          ✅ 提供全套宿主符号（napi_* / v8 Isolate / node AsyncResource / qq_magic_*）
  └─ LoadLibrary(wrapper.node)      ✅ 常规导入自动绑定 QQNT.dll，绕过 Node self-register 检查
  └─ process.dlopen(wrapper.node)   ✅ 成功（IAT hook GetProcAddress 拦 napi_register_module_v1 查询）
  └─ koffi 调 CreateNTSessionShell("Session")  ✅ 返回真实对象指针（host-v4 实测）
  └─ 激活链 FUN_180025d63/9d/28756  ✅ 无崩溃（activate-v2 实测，最小 SessionConfig）

**2026-08-06 P0-A 追加（env 兼容层成功）**：
  └─ IAT 改写 wrapper.node 99/101 槽 → node.exe 标准实现 ✅（41 napi_* + 57 uv_* + 1 Isolate）
  └─ 调主注册函数 FUN_180001000(env, exports) → **exports 89 个 = QQ 环境完全一致** ✅
  └─ 但登录链路失败（P0-B）→ 自建宿主判死，转路线 B（详见 §2.4 / §3）
```

### 2.3 三条核心风险（用户分析 + 我方验证，必须正视）

**风险 1：两套函数表（env 函数表 vs IAT 槽）**
- 标准 NAPI 模型：模块所有 napi_* 调用走 env 函数表（napi_register_module_v1 传入）
- wrapper.node 却是 **IAT 导入** napi_*（P0 实测：从 QQNT.dll 导入全套 napi_*）——不是标准工具链产物
- **✅ 已验证（P0-A）**：wrapper.node 内部是 **call [IAT槽]**（17520 个代码块直接引用 IAT 槽，napi-init-refs.txt 实证）——改写 IAT 槽有效，env 兼容层成功（89 exports）

**风险 2：v8 / AsyncResource 混合导入（严重性高）**
- wrapper.node 还从 QQNT.dll 导入 `?GetCurrent@Isolate@v8`、`?IsEnvironmentStopping@node` 等
- QQNT.dll 这些符号是**转发/桩**（指向 QQ Electron 的 v8），纯 Node 下可能解析不到或指向空
- wrapper.node 若真直调这些符号构造 env → 纯 Node 下未定义行为（非温和不兼容）

**风险 3：dlopen 成功 ≠ 登录可用（最被低估）**
- exports 完整只是「外壳能注册」；真正要命的是 `loginService.connect()` / `getQRCodePicture()` 需要 **QQNT.dll 进程级全局状态**（NT 运行时、密钥体系、网络栈），这些在 QQ Electron 里由主进程初始化，纯 Node 没人做
- **P0 的「exports 完整」是必要不充分条件**

### 2.4 两阶段 P0（✅ 已完成 2026-08-06，结论：路线 A 判死 → 转路线 B）

**P0-A：env 兼容层探针（✅ 成功）**
1. 改写 wrapper.node IAT 的 napi_* 槽 → 标准 Node env 函数表 ✅（99/101 槽）
2. 调主注册函数 FUN_180001000(env, exports) → **exports 89 个 = QQ 环境完全一致** ✅
3. 关键发现：**FUN_180001000（RVA 0x1000）才是总注册函数**（4 组：FUN_180bbd8b0 + FUN_1806de9b4≈85 服务 + FUN_180b60da4 6 Guild + FUN_1806a7fe0）；交接文档旧记的 FUN_180b60da4 只注册 6 个 Guild 服务
4. loginService 30 个方法全可用（initConfig/getQRCodePicture/connect/getLoginList/quickLoginWithUin...）

**P0-B：登录链路（❌ 失败——风险 3 应验，路线 A 判死）**
1. `engine.initWithDeskTopConfig`（**必须**，否则 initConfig 崩——它填充 wrapper.node 的全局 map）→ `initConfig` → `connect` → `getQRCodePicture` 表面调用全成功 ✅
2. **`getLoginList` 崩溃**；QR 登录后的**异步轮询回调**必然崩溃（wrapper.node 已注册 uv 定时器进 Node 事件循环，机制活了，但回调内部 QQNT.dll 对象未初始化）
3. 崩溃点固定：**QQNT.dll +0x3E1E302** `mov ebx,[rcx+rax+0x13]`（rdi+0x230 链表头=垃圾指针）；调用栈 wrapper.node(+0xAF99E2) → node.exe 事件循环 → QQNT.dll(+0x1AF8C71)
4. **根因**：QQNT.dll 的事件分发对象由 **QQ Electron 主进程 boot JS 创建**（进程级全局状态），纯 Node 无人初始化
5. 已穷尽排除：IAT 模式 0/1、session 激活链（activate=2）、TLS isolate 注入（逆向出桩=TLS 槽+0x230，注入成功但无效）、qq_magic_node_register

**🎯 结论**：纯标准 Node 自建宿主**无法完成登录** → **路线 A 判死，转路线 B**（NapCat 同款）。P0-A 的 env 兼容层成果在路线 B 下定位见 §3「成果定位」。

---

## 3. 路线 B：NapCat 同款（✅ 已验证全通 2026-08-06，正式落地）

```
pnpm start（apps/cli）
  └─ NapukettoBootMain.exe 拉起 QQ.exe + 注入 NapukettoWinBootHook.dll（已有，V1 资产）
  └─ hookdll IAT hook（已有）→ boot.cjs（NAPUTO_ROUTE_B=1）→ utilityProcess.fork(route-b-worker.cjs)  ← 新动作
       └─ Worker：process.dlopen(wrapper.node) → exports 89 个（继承 QQ env，无 IAT 改写）→ boot-bootstrap.js 复用
       └─ 登录 + 业务（kernel/adapter/network 零改动）
  └─ 无头：阻断 UI/GPU/Renderer（vehicle.cpp 已有）；主进程保留但无窗口
```

### 3.0 ✅ 端到端验证结果（2026-08-06 实测全通）

| 步骤 | 结果 |
|---|---|
| 注入 9.9.31 → electron 版本 | ✅ 37.1.0（定制 Electron 保留 utilityProcess） |
| boot.cjs 路线 B 分支（NAPUTO_ROUTE_B=1） | ✅ fork utilityProcess Worker（PID 4864，type=utility, NodeService） |
| worker dlopen wrapper.node | ✅ exports 89 个（QQ env 原生，无需 IAT 改写） |
| kernel 引导（boot-bootstrap.js 复用） | ✅ attachWrapper OK, session 方法面 85 个 |
| 登录链路 | ✅ 快速登录（无历史账号）失败 → QR 回退 |
| **QR 登录** | ✅ **二维码生成写盘 cache/qrcode.png（有效 PNG 605B）+ URL 打印** |

**验证结论**：路线 B 全链路打通，最终产品形态（控制台二维码 → 扫码登录）达成。
worker（utility 进程）独立于 QQ 主进程，继承 QQ env → 事件分发对象天然可用（P0-B 纯 Node 崩溃点消失）。

### 3.0.1 ⭐ P2-0 完整功能验证（2026-08-06 实测，试金石通过）

**卡点 1：appid 错误（扫码「请下载最新版」）**
- 硬编码 `537237765`（9.9.31）在 9.9.33 扫码失败「请下载最新版QQ」
- **解法（NapCat 自研等价）**：从 major.node 提取真实 appid——`QQAppId/` 标记后跟数字。9.9.33-51802 = **537376818**
- **已产品化**：`packages/kernel/src/wrapper-config.ts` 新增 `parseAppidFromMajor` + `resolveAppidQua`（导出）；boot-bootstrap.js 动态解析 APPID

**卡点 2：session 创建断言失败（new S() cpp_impl is not valid）**
- `new NodeIQQNTWrapperSession()` 构造对象缺 cpp_impl → init 断言失败（V1 老卡点）
- **解法（NapCat 同款）**：`StartupSessionWrapper.create()` + `getNTWrapperSession("nt_1")`（QQ 主 session，带 cpp_impl）+ `startupSession.start()` 替代 startNT
- **已产品化**：`wrapper-loader.ts` createSession 改为 NapCat 方式（SSW.create → getNTWrapperSession → create 回退）；startSession 优先 startupSession.start()

**P2-0 完整验证链路（全绿）**：
```
✅ 扫码登录成功（appid 537376818）
✅ StartupSessionWrapper.create() + getNTWrapperSession("nt_1") 返回 session
✅ session.init 无断言崩溃
✅ startupSession.start() 完成
🎉 onOpentelemetryInit({is_init: true}) + onSessionInitComplete(0)
🎉 getMsgService READY（1 秒挂载）—— V1 卡点彻底解决！
🎉 msgService 299 方法（addKernelMsgListener/sendMsg/fetchMsgList 全在）
```

**结论**：路线 B 已证明能跑通完整业务链路（登录 + session + service 挂载）。kernel/adapter 的 78 个 OneBot 动作底层依赖全部就位。

**遗留（P2-1）**：快速登录 1006511 网络异常（需像 NapCat 等网络稳定/重试）；kernel 在 worker 端到端跑通（收发消息实测 + OneBot 装配 + cli 一键启动）

- **业务层 100% NAPI 全免费**，维护成本最低（kernel/adapter 与注入路线共用）
- **代价**：QQ 主进程 300MB+（无头后），内存目标放宽到「300MB 级别」

### 3.1 utilityProcess 可用性：高置信度保留（仅需 1 个冒烟点确认）

- **判定：高置信度保留**，不是「未知」级风险。理由：
  1. `electron.utilityProcess` 是 **Electron 22+ 稳定 API**，腾讯无动机删除（删了破坏自家 Electron 生态兼容）
  2. **NapCat Shell 模式（Master=QQ 主进程注入 → utilityProcess Worker）完整跑通本身就是实证**——它现在就在生产环境这么跑
- **唯一的真实差异**：版本。参考 qqnt.json 对应 9.9.22-40990，我们要打 **9.9.31**，两者 Electron 内核版本可能不同
- **冒烟测试（10 分钟）**：注入 9.9.31 → 主进程 `process.versions.electron` 打印 + `utilityProcess.fork` 一个空 worker → 过了就全线打通

### 3.2 路线 B 硬约束（P0-B 用崩溃换来的经验，非优化项）

P0-B 崩溃根因（事件分发对象由 QQ Electron 主进程 boot JS 创建）直接解释了 NapCat 必须走
「BootMain 注入 → patch qqnt.json main」这条链：

1. **Master 注入点必须足够晚**（boot JS 完成对象初始化之后、仍在主进程上下文执行）——patch qqnt.json 的 main 入口正好满足
2. **Worker 必须 fork（utilityProcess），不是新起进程**——只有 fork 才继承 QQ env，事件分发对象天然可用
3. 顺序：patch main（QQ boot JS 先跑）→ 我们的代码在 QQ 已初始化后执行 → fork Worker → Worker 内 dlopen

### 3.3 成果定位（P0-A 成果在路线 B 下的角色——诚实评估）

| P0-A 成果 | 路线 B 下的定位 |
|---|---|
| IAT 改写（99/101 槽→node.exe） | **降级为附录/存档**（自建宿主专属工程，路线 B 直接继承 QQ env 用不上） |
| 89 exports 完整加载 | **知识资产**：证明 wrapper.node 可脱离 QQ Electron 完整加载，boot.cjs 业务层可复用 |
| FUN_180001000 主注册函数（≈85 服务） | **核心资产**：boot.cjs 调用各 Service 的依据，交接文档必须保留 |
| loginService 30 方法清单 | **核心资产**：直接是业务层实现 |

### 3.4 骨架复用（不从零造）

- **本工作区已有自研等价骨架**（V1 注入链，非 NapCat 代码）：
  - `packages/loader/native/bootmain.cpp`（= 自研 BootMain，拉起 QQ + 注入）
  - `packages/loader/native/hookdll.cpp`（= 自研 Hook DLL，IAT hook + boot JS 引导）
  - `packages/loader/src/launcher.ts`（= 自研 launcher）
  - `packages/loader/runtime/boot.cjs` + 5 模块（= 自研 boot JS 编排）
- 路线 B = **「NapCat 骨架 + 自研业务层」**：复用上述注入链做 Master，新增 utilityProcess.fork Worker 动作，业务层（kernel/adapter/network）零改动
- NapCat 同款**不抄代码**（Limited Redistribution License + napi2native 闭源），只借鉴「架构动作」：注入 → patch main → utilityProcess → Worker 内 dlopen

---

## 4. 红线与合规（两路线都适用，务必遵守）

1. **不抄 NapCat**：Limited Redistribution License，napi2native 闭源。业务层接口签名是腾讯 wrapper.node 外部事实，可自研描述；架构原创
2. **业务逻辑零逆向**：业务 100% 走官方 NAPI 接口。**禁止 koffi / vtable 槽位 / 内存偏移 / thiscall 裸调**（AGENTS.md 红线）
3. **零磁盘篡改**：内存 Patch 只在运行期 RAM 生效，严禁修改 QQ 安装目录二进制
4. **目的单一性**：C++ 逆向/Hook 仅用于「无头 + env 兼容」，业务不碰
5. **逆向产物管理**：RVA 表 / 定位脚本只存本地/私有，不提交公共仓库

---

## 5. 已验证资产清单（scripts-tmp/，已 gitignore）

| 资产 | 状态 | 用途 |
|---|---|---|
| `host-test-v4.mjs` | ✅ | koffi 调 CreateNTSessionShell → 真实对象指针（0x1faef126030） |
| `activate-v1/v2.mjs` | ✅ | 激活链 FUN_180025d63/9d + init（最小 SessionConfig）无崩溃 |
| `verify-object.mjs` | ✅ | 对象 vtable 验证（RVA 0x395c068，INTSessionShell 同段） |
| `qqnt-host-helper.cpp/.node` | ✅ | DllMain 加载 QQNT.dll + wrapper.node + PATH |
| `qqnt-host-helper2.cpp/.node` | ✅ | IAT hook GetProcAddress（P0：dlopen 成功）；三种 stub 模式 |
| `bypass-test.mjs` | ✅ | dlopen 验证 + exports 检查（NAPUTO_STUB_MODE 0/1/2） |
| `diag-mode2.mjs` | ✅ | mode=2 崩溃诊断（确认 0xC0000005 = env 不兼容） |
| `qqnt-host-helper3.cpp/.node` | ✅ **P0-A 核心** | IAT 改写（99/101 槽）+ 调 FUN_180001000 + VEH 栈回溯 + TLS isolate 注入 + qq_magic 实验 |
| `p0a-*.mjs` / `p0b-child.mjs` | ✅ P0 探针 | env 兼容层验证（89 exports）+ 登录链路验证（崩溃定位） |
| `enum-node-exports.mjs` | ✅ | node.exe 导出枚举（145 napi_*） |
| `find-service-registrars.mjs` | ✅ | 服务注册函数静态定位 |
| `analyze-wrapper-exports.mjs` | ✅ | wrapper.node 导出表 + 服务类名 RVA 定位 |
| `qqnt-probe.mjs` | ✅ | QQNT.dll 桩实现运行时读取（Isolate 桩 = TLS 槽+0x230） |
| `napi-init-refs.txt` / `magic-callers.txt` | ✅ | 逆向分析产物（wrapper.node napi 引用 / qq_magic thunk） |

**关键 RVA**（vehicle.cpp 私有表，勿进公共仓库）：
- `CreateNTSessionShell` 导出 RVA 0x25BEA
- 激活链：FUN_180025d63（创建）/ FUN_180025d9d（注册）/ FUN_180028756（init）
- **主注册函数：FUN_180001000（RVA 0x1000，P0-A 实测）**——4 组：FUN_180bbd8b0 + FUN_1806de9b4（≈85 核心服务）+ FUN_180b60da4（6 Guild）+ FUN_1806a7fe0；**交接文档旧记的 FUN_180b60da4（RVA 0xb60da4）只注册 6 个 Guild 服务**
- 登录链路崩溃点：QQNT.dll +0x3E1E302（事件分发对象未初始化）
- SessionConfig 最小字段：+0x268（QQ std::string）、+0x280（char=1）、+0x3f8（char=1）
- QQ std::string = 32 字节 SSO（buf[16]+size+capacity）
- QQNT.dll v8::Isolate::GetCurrent 桩 = TLS 槽 +0x230（P0-A 逆向）

**环境**：koffi 在 `node_modules/.pnpm/koffi@3.1.4/node_modules/koffi`（非直接依赖）；真实 python `C:\Users\xiaoxiaochen\AppData\Local\Python\bin\python.exe`；g++ `...\MartinStorsjo.LLVM-MinGW.UCRT_...\bin\g++.exe`；node_api.h `...\node-gyp\Cache\24.16.0\include\node\node_api.h`

---

## 6. 工作清单（按优先级）

- [x] **P0-A**：env 兼容层探针 ✅（IAT 改写 + FUN_180001000 → exports 89 个）
- [x] **P0-B**：登录链路 ❌（getLoginList/轮询回调崩溃 → 路线 A 判死）
- [x] **P1-1**：路线 B 冒烟 ✅（注入 9.9.31 → electron 37.1.0 + utilityProcess.fork 空 worker）
- [x] **P1-2**：worker 深度探针 ✅（dlopen 89 exports + engine + initConfig + connect + **QR 二维码回调**）
- [x] **P1-3**：路线 B 落地 ✅（boot.cjs NAPUTO_ROUTE_B 分支 + route-b-worker.cjs + boot-bootstrap 复用 + **QR 二维码写盘 cache/qrcode.png**）
- [x] **P2-0**：完整功能验证 ✅（appid 动态解析 537376818 + NapCat 式 session 创建 + **getMsgService READY** + msgService 299 方法）
- [x] **产品化迁移** ✅（parseAppidFromMajor/resolveAppidQua → wrapper-config.ts；createSession NapCat 方式 → wrapper-loader.ts；boot-bootstrap APPID 动态解析）
- [ ] **P2-1**：kernel 在 worker 端到端跑通——收发消息实测（addKernelMsgListener/sendMsg）+ OneBot 装配 + 快速登录重试（1006511）
- [ ] **P2-2**：cli 一键启动改造（默认 NAPUTO_ROUTE_B=1 + 控制台二维码 ANSI 渲染 + 无头默认）
- [ ] P3：内存实测与优化（无头 + 300MB 级）

---

## 7. 环境坑（复用 V3 §9，务必记住）

- **PowerShell PATH 间歇失效**：python/cmd/taskkill 时好时坏，用绝对路径
- **终端输出被管道吞**：避免 `| Select-Object` / `| Out-String` / 重定向，直接跑命令；大输出写文件再读
- **bootmain 拉起 QQ 后挂起直到 QQ 退出** → spawnSync 会占终端；用 async 模式 + 观察日志文件
- **GhidraMCP 8080**：需要 Ghidra GUI + 插件 HTTP 服务

---

## 8. git 状态

- HEAD = `843dd04`，工作区干净
- `scripts-tmp/` 和 `docs/` 下 V2/V3/V4 文档（含 RVA 表）按红线 gitignore 保持本地
- **红线**：RVA 表 / Offset / 逆向产物绝不进公共仓库

---

## 2. 自建宿主最终架构（目标形态）

```
pnpm start（apps/cli）
  └─ 定位 QQ 安装目录（locate-qq，已有）
  └─ 启动标准 Node 自建宿主进程（spawn node，无 QQ 进程）
       └─ helper DLL（qqnt-host-helper 类）DllMain：
            SetDllDirectory + PATH → LoadLibrary QQNT.dll → LoadLibrary wrapper.node
       └─ koffi 加载 wrapper.node（已存在 scripts-tmp/host-test-v4.mjs 骨架）
            ├─ CreateNTSessionShell("Session") → session 对象
            ├─ 激活链（创建/注册/init，最小 SessionConfig）
            └─ 业务层打通 ← 【关键未知，见 §3】
       └─ boot 流程：登录（扫码/快速）→ kernel 装配 → adapter → OneBot 服务
       └─ 控制台二维码输出（QrLoginSession 已有，kernel login.ts）
```

**与现有代码的关系**：
- 复用：kernel 全部（apis/cache/lifecycle/msg-bridge/group-bridge）+ adapter + network + cli
- 替换：`boot.cjs` 的「截获 NAPI exports」→ 「koffi 拿 session + 业务 service」
- 关键改造点：kernel 需要新增「koffi 后端」（当前 wrapper 层是 NAPI 调用范式）

---

## 3. 关键未知与 P0 实验（新对话第一优先级）

### P0-A：业务层能否通过 koffi 拿到并调用 loginService（决定性）
- 目标：`NodeIKernelLoginService` 对象能否从 session 上获取（koffi 调 getMsgService 类似接口或 vtable 槽）
- 若成功 → 登录（快速登录 getLoginList/quickLoginWithUin 或扫码 getQRCodePicture）→ 业务全通
- 若失败 → 需评估逆 vtable 槽位的工作量（INTSessionShell vtable RVA 0x395c068 已有）

### P0-B：扫码登录链路在自建宿主验证
- `QrLoginSession`（kernel login.ts 已有）依赖的 service 接口能否 koffi 打通
- 控制台二维码输出（终端 ANSI 或 ASCII 二维码，cli 已有 QR 库？需确认）

### P0-C：内存实测
- 自建宿主进程 RSS：Node + wrapper.node + QQNT.dll 工作集实际多少
- 若超 100MB：分析大头（DLL 段按需换页优化 / 不需要的依赖 DLL 剔除）

### P0-D：session init 依赖的服务栈
- V2 卡点（getMsgService=null）在自建宿主是否同样出现
- 最小 SessionConfig 已能用（activate-v2），但要确认完整 init 后 msg/group/friend service 是否挂载

---

## 4. 已验证资产清单（scripts-tmp/，已 gitignore）

| 资产 | 状态 | 用途 |
|---|---|---|
| `host-test-v4.mjs` | ✅ | koffi 调 CreateNTSessionShell → 真实对象指针（0x1faef126030） |
| `activate-v1/v2.mjs` | ✅ | 激活链 FUN_180025d63/9d + init（最小 SessionConfig）无崩溃 |
| `verify-object.mjs` | ✅ | 对象 vtable 验证（RVA 0x395c068，INTSessionShell 同段） |
| `qqnt-host-helper.cpp/.node` | ✅ | DllMain 加载 QQNT.dll + wrapper.node + PATH |
| `qqnt-host-helper2.cpp/.node` | ✅ | IAT hook GetProcAddress（P0：dlopen 成功）；三种 stub 模式 |
| `bypass-test.mjs` | ✅ | dlopen 验证 + exports 检查（NAPUTO_STUB_MODE 0/1/2） |
| `diag-mode2.mjs` | ✅ | mode=2 崩溃诊断（确认 0xC0000005 = env 不兼容） |
| `napi-init-refs.txt` / `magic-callers.txt` | ✅ | 逆向分析产物（wrapper.node napi 引用 / qq_magic thunk） |

**关键 RVA**（vehicle.cpp 私有表，勿进公共仓库）：
- `CreateNTSessionShell` 导出 RVA 0x25BEA
- 激活链：FUN_180025d63（创建）/ FUN_180025d9d（注册）/ FUN_180028756（init）
- 总注册函数：FUN_180b60da4（exports 构造，NAPI 环境下才可用）
- SessionConfig 最小字段：+0x268（QQ std::string）、+0x280（char=1）、+0x3f8（char=1）
- QQ std::string = 32 字节 SSO（buf[16]+size+capacity）

**环境**：koffi 在 `node_modules/.pnpm/koffi@3.1.4/node_modules/koffi`（非直接依赖，集成需 `pnpm add koffi`）；真实 python `C:\Users\xiaoxiaochen\AppData\Local\Python\bin\python.exe`

---

## 5. 工作清单（按优先级）

- [ ] **P0-A**：koffi 打通 loginService（决定性，见 §3）
- [ ] **P0-B**：扫码登录链路（QrLoginSession + 控制台二维码）
- [ ] **P0-C**：内存实测与优化（百兆目标）
- [ ] **P0-D**：session init 后 service 挂载验证
- [ ] P1：kernel 增加 koffi 后端（当前 wrapper 是 NAPI 范式；注意红线——业务层接口签名自研描述，不抄 NapCat 类型）
- [ ] P1：SessionConfig 完整结构逆向（Ghidra，当前只知最小字段）
- [ ] P1：cli 一键启动改造（spawn 自建宿主进程 + 扫码交互）
- [ ] P2：多账号/进程隔离、supervisor 复用
- [ ] P2：wrapper.node 版本兼容（wrapper-version.ts 已有探测）

---

## 6. 红线与风险（务必遵守）

1. **不抄 NapCat**：其代码是 Limited Redistribution License，`napi2native` 闭源。业务层接口签名是腾讯 wrapper.node 外部事实，可自研描述；架构与实现必须原创
2. **业务逻辑零逆向**：koffi 调官方导出符号 + vtable 槽位是「调用外部 ABI」，不是「篡改业务逻辑」——但 vtable 槽位逆向产物（RVA 表）只存本地/私有，不提交公共仓库
3. **零磁盘篡改**：内存 Patch 只在运行期 RAM 生效，严禁修改 QQ 安装目录二进制
4. **目的单一性**：C++ 逆向/Hook 仅用于「无头 + 激活信号」，业务 100% 走官方接口
5. **风险提示**：wrapper.node 版本更新可能改 vtable 槽位 → wrapper-version 探测 + 版本-槽位映射表维护

---

## 7. 环境坑（复用 V3 §9，务必记住）

- **PowerShell PATH 间歇失效**：python/cmd/taskkill 时好时坏，用绝对路径
- **终端输出被管道吞**：避免 `| Select-Object` / `| Out-String` / 重定向，直接跑命令；大输出写文件再读
- **g++**：`C:\Users\xiaoxiaochen\AppData\Local\Microsoft\WinGet\Packages\MartinStorsjo.LLVM-MinGW.UCRT_...\bin\g++.exe`
- **node_api.h**：`C:\Users\xiaoxiaochen\AppData\Local\node-gyp\Cache\24.16.0\include\node\node_api.h`
- **GhidraMCP 8080**：需要 Ghidra GUI + 插件 HTTP 服务

---

## 8. git 状态

- HEAD = `843dd04`，工作区干净
- `scripts-tmp/` 和 `docs/` 下 V2/V3/V4 文档（含 RVA 表）按红线 gitignore 保持本地
- **红线**：RVA 表 / Offset / 逆向产物绝不进公共仓库
