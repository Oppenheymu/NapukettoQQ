# NapukettoQQ 项目现状（2026-08-07 深夜更新：🎉 session READY 突破，路线 A 可救）

> **新对话开场指引**：先读本文件（现状 + 关键决策点）→ `AGENTS.md`（工程指南 + 红线）→ `docs/architecture.md`（架构书）→ **`docs/HANDOVER-V10.md`（最终交接）** → 对应包 `docs/design.md`。需要细节时再读 HANDOVER-V6~V9。需要了解路线演进背景时再读 `docs/DECISIONS.md`。
>
> **git 状态**：HEAD = `ea07ab4`（kernel 落地提交），工作区干净。`docs/` 已纳入 git 跟踪。

---

## 🏆 关键决策点（2026-08-07 深夜更新：**🎉 session READY 突破，路线 A 可救**）

> **🎉 决定性突破（2026-08-07 深夜，HANDOVER-V9，推翻 V8「硬墙」结论）**：自建宿主（标准 node +
> stub QQNT.dll）**session 业务 service 可激活**——关键 = **`session.init(config)` 之后调
> `startupSession.start()`**（NapCat initializeSession 顺序）。改正顺序后
> `onOpentelemetryInit(is_init=true)` 触发，**getMsgService READY（298 方法）+ getGroupService/
> getBuddyService/getTicketService/getProfileService 全部有效**。此前失败（V8 记录）是因为
> 先 `ssw.start()` 再 init（顺序颠倒）或 init 后 startNT（非 startupSession.start）。
> 隔离实验：O3 上报 / UUID guid / deviceConfig 均非必要。**路线 A 可救，产品路线主攻。**
>
> **✅ 自建宿主验证通过（2026-08-07，p0-login3.mjs）**：纯 Node（系统 node v24）+ 9.9.33 官方
> wrapper.node + stub QQNT.dll 转发 + `O3MiscService` 激活事件分发 → **完整登录成功**
> （getLoginList 7 账号 → onLoginConnected → quickLoginWithUin 成功）。
>
> **✅ stub QQNT.dll 等价物完成（2026-08-07 晚，HANDOVER-V7/V8）**：
> llvm-mingw 编译 **69KB PE 转发 stub**（100 条：99 静态转发 + PerfTrace 空实现），替换 NapCat
> 闭源 stub（481KB）后完整登录成功——**产品化前置解除**（正式版 stub-qqnt.cpp 已在 native-private）。
>
> 三要素（勿重复探索）：① 加载 = **stub QQNT.dll 转发**（napi_* → node.exe，无需 IAT 改写；
> host-helper IAT 方案事件分发不工作已弃用）② **`NodeIO3MiscService.get()` + `addO3MiscListener`**
> 激活事件分发（否则 getLoginList 永不 resolve）③ commonPath/desktopGlobalPath = `数据根/nt_qq/global`。
>
> **session READY 四步（V9 决定性）**：登录成功 → `session.init(config, depends, dispatcher, listener)`
> → **`startupSession.start()`**（先 init 后 start！）→ 等 `onOpentelemetryInit(is_init=true)`。
>
> 下一步：kernel 落地（修正 lifecycle initAndStartSession 顺序）→ 冒烟收发 → 内存实测 → loader
> 自建宿主引导（NAPUTO_SELF_HOST 分支）。账号注意：快速登录 3054108135 会挂起（账号风控），
> 测试用 **3567141148**（已验证成功）。

**功能范围（用户拍板）**：**NapCat 全部能力（协议 + API）− WebUI − 插件系统**。
**逆向边界（用户拍板：非 0 逆向）**：允许必要逆向——环境模拟/反风控（进程名伪装、
模块隐藏、RWX→RX、窗口类）、数据包层 hook（Frida Gum 等价物）、无头阻断。
业务层优先 NAPI（优先级非禁令），技术手段不设限但仅限 loader 载具层；**许可证底线不变：
零引入 NapCat 代码**。详见 `AGENTS.md` 第 7 条。

**背景**：路线 A（自建宿主 + env 兼容层）曾用**已下线的 9.9.31** 判死（P0-B：纯 Node 下
QQNT.dll 事件分发对象无人初始化 → 登录崩溃）。但后来发现 **NapCat 纯 Node 模式（9.9.27 +
napi2native）能跑通**（无 QQ 进程无 UI，双进程仅 ~237MB，且能登录）——判死可能不成立。

**napi2native 真实职责（字符串分析实证，不是 env 兼容层）**：
- 反风控/环境模拟：进程名伪装 QQ.exe、隐藏注入模块（K32EnumProcessModules/GetModuleHandleW hook）、
  内存 RWX→RX 伪装、创建 `Base_PowerMessageWindow`（QQ 窗口类，QQNT.dll 内部依赖窗口消息循环）、
  数据包层 hook（Frida Gum，可选）

**自建宿主失败的可能真相**：
1. P0-B 用的是 9.9.31 的 QQNT.dll（**登录服务已被腾讯下线**，后来升级 9.9.33 扫码才成功）——崩溃可能是版本问题而非纯 Node 问题
2. napi2native 创建的窗口类可能对登录有用（QQNT.dll 依赖窗口消息循环）
3. ~~**未验证**：9.9.33 QQNT.dll + 纯 Node + 窗口类 + 票据能否登录~~ **已验证通过（2026-08-07）**：
   纯 Node + stub QQNT.dll 转发 + O3MiscService 激活事件分发 + 快速登录成功

**验证实验（可决定性区分，P2-2 第一优先）**：
```
9.9.33 资源 + 纯 Node dlopen(wrapper.node) + 建 Base_PowerMessageWindow + 已有票据登录
成功 → 自建宿主可救（百兆级可达，产品路线 = 自建宿主优先）
失败 → 才是 env 硬墙，路线 B（300MB 注入）为产品路线
```
> **✅✅ 已验证可救（2026-08-07 深夜，HANDOVER-V9）**：登录 ✅ + **session READY ✅**（先 init 后
> startupSession.start()，业务 service 全部激活）。不是 env 硬墙。

**产品路线（2026-08-07 深夜最终）**：
| 路线 | 形态 | 内存 | 状态 |
|---|---|---|---|
| **A. 自建宿主复活** | 标准 Node + stub QQNT.dll + 窗口类 | ~100MB（待实测） | ✅✅ **主攻**（登录 ✅ + session READY ✅） |
| **B. 注入 utilityProcess Worker**（NapCat 同款） | 注入 QQ 主进程 → worker dlopen | 300MB+（无头后待实测） | ✅ 已全链路验证，**兜底** |
| C. V1/V2 注入（主进程直接引导） | — | 1.01GB | ❌ 已排除 |

---

## ✅ 已验证结论（全部实测，勿重复探索）

### 路线 B 全链路（2026-08-06，兜底基线，P0-A/B → P2-1 全通）

```
pnpm start（apps/cli）
  └─ NapukettoBootMain.exe 拉起 QQ.exe + 注入 NapukettoWinBootHook.dll（自研 V1 资产）
  └─ hookdll IAT hook → 引导 boot.cjs（NAPUTO_ROUTE_B=1 分支）
  └─ boot.cjs fork utilityProcess Worker（继承 QQ env）→ route-b-worker.cjs
       └─ worker 内 process.dlopen(wrapper.node) → exports 98 个（QQ env 原生，无需 IAT 改写）
       └─ boot-bootstrap.js 复用 → kernel 装配 → 登录（快速/QR）→ session → 协议装配
  └─ 无头：阻断 UI/GPU/Renderer（vehicle.cpp 已有）；主进程保留但无窗口
```

**P2-0 试金石通过（c42d20d）**：① appid 从 major.node 动态解析（9.9.33-51802 = **537376818**，
NapCat parseAppidFromMajorV2 自研等价）② session 用 NapCat 方式
（`StartupSessionWrapper.create()` → `getNTWrapperSession("nt_1")` → `startupSession.start()`，
**不要 `new NodeIQQNTWrapperSession()`**——cpp_impl 断言失败）③ **getMsgService READY（1s）+
msgService 299 方法**（addKernelMsgListener/sendMsg/fetchMsgList 全在）。

**P2-1 代码落地（ad8a926）**：① 快速登录网络重试（lifecycle.ts：waitForNetworkConnection
轮询 getMsfStatus()===3 + quickLogin 1006511 重试×3）② 冒烟自检（boot-smoke.js，NAPUTO_SMOKE=1
触发：MsgBridge+MsgApi 真发/收一条 + 落库核对）③ **cli 默认路线 B**（launcher 透传 NAPUTO_ROUTE_B=1）。

**P0-A（env 兼容层）**：IAT 改写 wrapper.node 99/101 槽 → node.exe 标准实现 → 89 exports。
**结论**：知识资产（证明 wrapper.node 可脱离 QQ Electron 完整加载），路线 B 用不上、自建宿主复活可参考。

### 产品化状态（已提交，勿重复实现）

| 迁移项 | 位置 | 说明 |
|---|---|---|
| appid 动态解析 | `packages/kernel/src/wrapper-config.ts` | `parseAppidFromMajor` + `resolveAppidQua` + `externalVersion: false` |
| NapCat 式 session 创建 | `packages/kernel/src/wrapper-loader.ts` | createSession：SSW.create → getNTWrapperSession("nt_1") → create 回退；startSession 优先 startupSession.start() |
| worker 引导 | `packages/loader/runtime/route-b-worker.cjs` | dlopen → bootstrap(state) 复用 |
| 路线 B 分支 | `packages/loader/runtime/boot.cjs` | NAPUTO_ROUTE_B=1 → fork worker + 主进程存活 |
| 快速登录重试 | `packages/kernel/src/lifecycle.ts` | waitForNetworkConnection + 1006511 重试×3 |
| 冒烟自检 | `packages/loader/runtime/boot-smoke.js` | NAPUTO_SMOKE=1 触发收发验证 |
| cli 默认路线 B | `packages/loader/src/launcher.ts` | LaunchOptions.routeB 默认 true |

---

## 📦 已完成功能（截至 2026-08-06，均有提交）

- **kernel**：errors/paths/logger/config（TOML）/event-channel/wrapper 全套（version/loader/config/adapters）/
  context+core 装配层 / lifecycle / login（QR 状态机 + 快速登录重试）/ MsgBridge + GroupBridge /
  cache（GroupCache 只读视图）/ **apis 12 个**（Msg/Group/GroupNotify/Friend/Ticket/RichMedia/Profile/
  ProfileLike/WebApi + PathWrapper 等）——详见 `packages/kernel/docs/design.md`
- **adapter**：core 框架（BaseProtocolAdapter/BaseAction/ActionRegistry/AdapterRegistry/ProtocolConfig）
  + onebot11 全量（**78 个动作**，message/group/friend/system 四分组 + api 聚合 OneBotApi + GroupCache
  消费 + error-map + CQ 码 + 事件模型 + HTTP/WS 传输 + 鉴权 + 心跳）
- **network**：完整（HttpServer/HttpClient/WsServer/WsClient/EventBroadcaster）
- **media**：完整（image/audio(silk)/video(ffmpeg)）
- **loader**：注入引导全链路（launcher/locate-qq/boot.cjs 6 模块/native bootmain+hookdll）+ V2 载具
  （native-private/vehicle.cpp，闭源）+ 路线 B worker 引导
- **cli**：commander（-q/-d/--qq-path）+ 一键启动（读全局配置 accounts）+ config 子命令
  （init/list/apply，napuketto.toml 单一 TOML）+ supervisor 多账号编排
- **配置路径修订（2026-08-07）**：全局配置文件移到项目根 `<项目根>/napuketto.toml`（用户拍板：
  不喜欢配置堆用户目录），数据（账号目录/日志/缓存/QQ 数据）仍按数据根组织；kernel 新增
  `resolveConfigPath`（NAPKETTO_CONFIG 显式 > 项目根探测 > cwd > 数据根兜底），
  cli config 子命令 / boot / loader 装配链同步更新

**API 来源分层**（回答「onebot11 规范吗」）：标准 OneBot 11 规范 30 个 + go-cqhttp 扩展 + NapCat
扩展三层；`protocol_version: "v11"` 不变，扩展动作 schema 来自 NapCat/go-cqhttp 而非规范，以
`packages/adapter/docs/design.md` 的清单为准。对齐度 ≈ 70%。

---

## 🎯 功能范围（2026-08-06 用户拍板：NapCat 全部能力 − WebUI − 插件系统）

| NapCat 能力域 | 我们 | 差距 |
|---|---|---|
| OneBot 11 协议（HTTP/WS/反向） | ✅ 78 动作 | 对齐 ≈70%，缺冷门扩展 |
| Satori 协议 | 🔶 占位 | 待做（复用 core 框架） |
| 扫码/快速登录 | ✅ | 无 |
| 纯 Node 自建宿主 | 🔶 待验证 | **P2-2 第一优先** |
| 数据包层（packet 后端） | ❌ | 逆向已解禁，远期对齐 |
| WebUI / 插件系统 | ❌（红线） | **明确不做** |

## 🔥 下一步（按优先级）

### 0️⃣ 自建宿主落地（P2-2 第一优先，验证已通过）
- [x] **登录链路验证通过（2026-08-07）**：纯 Node + stub QQNT.dll 转发 + O3MiscService 激活事件分发 + 快速登录成功（路线 A 定案）
- [x] **stub QQNT.dll 等价物完成（2026-08-07 晚）**：llvm-mingw 编译 70KB PE 转发 stub（99 符号），替换 NapCat 闭源 stub 后登录成功（HANDOVER-V7）
- [ ] **整理正式版 stub**（stub-qqnt.cpp 正式化 + compare-symbols.mjs 重跑机制 + PerfTrace 补足（低优先））
- [ ] **session READY 验证**：登录成功后 getMsgService() 是否可用（→ kernel/adapter 零改动复用 + 冒烟收发）
- [ ] **内存实测**：标准 node + stub + wrapper + 登录态（对照路线 B 300MB+，目标百兆级）
- [ ] **loader 自建宿主引导**：新增 NAPUTO_SELF_HOST 分支（标准 node + stub + boot.cjs 复用，替代路线 B 注入链路）

### P2-1 实测（功能最后一块）
- [ ] 实机跑 `pnpm start`（默认路线 B worker），设 `NAPUTO_SMOKE=1` 看冒烟日志（napuketto-boot.log 中 smoke: 行）验证收发
- [ ] OneBot 装配（adapter OB11 HTTP/WS + network）端到端验证

### P2-2 无头/低内存（验收标准 3/4）
- [ ] 候选 A：**自建宿主落地**（验证已通过，loader 新增引导即完成）
- [ ] 候选 B：路线 B + main 替换（注入后改 QQ main 阻止 UI，NapCat 注入模式做法，内存应降）
- [ ] 候选 C：维持路线 B + 事后抑制（当前 600-700MB ❌ 用户已测，不可接受）

### P3 打磨
- [ ] 内存实测（无头 + 目标达成）；多账号/进程隔离、supervisor 复用
- [ ] 版本兼容：wrapper-version.ts 探测 + appid 表维护（QQ 升级重跑 major 解析）

---

## ⚠️ 关键环境事实（务必记住）

- **QQ 已升级 9.9.33-51802**：`C:\Dev\QQBot-Dev\QQNT\`（wrapper.node 114MB，exports **98 个**）。
  旧 9.9.31 在 `C:\Program Files\Tencent\QQNT\`（登录服务已被腾讯下线，扫码「请下载最新版」）
- **appid 机制**：每版本从 major.node 的 `QQAppId/` 标记提取。9.9.33-51802 = 537376818；9.9.31 = 537237765
- **session 必须 NapCat 方式**：`getNTWrapperSession("nt_1")` 或 `StartupSessionWrapper.create()`，
  不要 `new NodeIQQNTWrapperSession()`（cpp_impl 断言失败）
- **initConfig 必须 `externalVersion: false`**（扫码兼容）
- **commonPath** 用 `getNTUserDataInfoConfig()` 返回路径的 `nt_qq/global`，engine desktopGlobalPath 同
- **QQ 登录数据**：`C:\Users\xiaoxiaochen\Documents\Tencent Files\`（含 7 个账号）
- **NapCat 参考**：`C:\Dev\NapCat.Shell.Windows.Node1`（Shell 部署包，纯 Node 模式实证 ~237MB）

---

## 🚫 红线（两路线都适用，来自 AGENTS.md 第 7 条）

1. **零引入 NapCat 代码**（GPL-2.0 / Limited Redistribution License 与 MIT 不兼容；napi2native 闭源）；
   只借鉴架构动作，实现自研
2. **允许必要逆向（2026-08-06 用户拍板）**：环境模拟/反风控（进程名伪装、模块隐藏、RWX→RX、
   窗口类）、数据包层 hook、无头阻断均可逆向；业务层**优先** NAPI（优先级非禁令），
   NAPI 覆盖不了的能力用 C++ 逆向补足；技术手段不设限但**仅限 loader 载具层**
3. **零磁盘篡改**：内存 Patch 只在运行期 RAM；严禁改 QQ 安装目录二进制
4. **逆向产物不进公共仓库**：RVA 表 / Offset 仅存私有（`native-private/` 只分发编译+混淆二进制）

---

## 🌱 环境坑（复用历史）

- PowerShell PATH 间歇失效 → 用绝对路径（python/g++/taskkill）
- 崩溃子进程占 DLL 句柄 → 编译 Permission denied → 杀残留 node 进程
- wrapper.node 加载后进程不退出（后台线程）→ 测试脚本需 process.exit
- bootmain 拉起 QQ 后挂起 → async 模式 + 观察日志文件
- read_file 对正在写入的 boot.log 有缓存 → 用 PowerShell `Get-Content -Raw`
