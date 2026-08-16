# NapukettoQQ 决策史（V1 → V10，2026-08-07 整理）

> **用途**：路线演进与关键决策的存档，**新对话一般不需要读本文件**——先读 `docs/STATUS.md`（现状）
> 和 `docs/architecture.md`（架构书）。仅在需要理解「为什么走到今天」时查阅本节。
> 旧文档（HANDOVER.md / V2 / V3 / V4 / V5 + 3 份 architecture）已合并进本文件 + STATUS + architecture，
> 原始内容保留在 git 历史（归档提交 `d9a790e`）。

---

## 时间线总览

| 阶段 | 时间 | 决策 | 结论 | 存档 |
|---|---|---|---|---|
| V1 | 2026-08-05 | 纯 NAPI 注入路线（IAT hook 引导 boot JS） | ✅ 全链路打通，但 1.01GB 内存 | HANDOVER.md → 本文件 §1 |
| V2 | 2026-08-06 | Native Bypass 载具（Ghidra 逆向） | ✅ 激活链跑通；发现 wrapper.node 可脱离 QQ Electron 加载 | HANDOVER-V2 → 本文件 §2 |
| V3 | 2026-08-06 晚 | 自建宿主（标准 Node 独立进程） | ✅ session 可创建；业务层 koffi 路线被否 | HANDOVER-V3 → 本文件 §3 |
| V4 | 2026-08-06 深夜 | 双层路线（A 自建宿主优先 / B NapCat 同款兜底） | ❌ 路线 A P0-B 判死（9.9.31）→ 转 B | HANDOVER-V4 → 本文件 §4 |
| V5 | 2026-08-06 | 路线 B 定稿 + 全链路验证 | ✅ P2-0 试金石通过；**深夜发现判死存疑** | HANDOVER-V5 → 本文件 §5 |
| V6 | 2026-08-06 | 功能范围 + 逆向边界拍板 | ✅ 范围 = NapCat − WebUI − 插件系统；**允许必要逆向**（非 0 逆向） | 本文件 §6 |
| V7 | 2026-08-07 早 | 自研 stub QQNT.dll 等价物（llvm-mingw 69KB 转发 stub，99 符号） | ✅ 替换 NapCat 闭源 stub，登录链路验证通过 | 本文件 §7 |
| V8 | 2026-08-07 晚 | 正式版 stub（PerfTrace 空实现）；自建宿主「硬墙」误判 | ⚠️ 误判（V9 推翻） | 本文件 §7 |
| V9 | 2026-08-07 深夜 | session READY 突破（先 init 后 startupSession.start） | ✅ 业务 service 全激活，推翻 V8 硬墙 | 本文件 §7 |
| V10 | 2026-08-07 | **业务基本实现 + 自建宿主唯一路线** | ✅ 全链路跑通（登录→READY→收发→onebot11→消息接收），cli 默认自建宿主 | 本文件 §7 |

---

## 1. V1：纯 NAPI 注入路线（2026-08-05）

**决策**：wrapper.node 只能在 QQ 定制 Electron 主进程内由 preload 注册（纯 Node/普通 Electron 报
"Module did not self-register"）。`@napuketto/loader` 注入 hook DLL 引导 boot JS 进 QQ 主进程，
截获 wrapper.node exports，业务层全部走 NAPI 对象调用。

**关键认知（仍有效）**：
- exports 89 键无 NodeI*Adapter/Listener 构造器 → adapter/listener 传普通 JS 对象（NAPI 反射读取方法回调）
- session 获取：`NodeIQQNTStartupSessionWrapper.create()` → `getSessionIdList()` → `getNTWrapperSession("nt_3")`
  返回空 session（service 全 null）；QQ 已登录 session 需 Proxy 拦截 `new NodeIQQNTWrapperSession()` 捕获
- 登录：`initConfig({appid, clientVer, commonPath})` + `getLoginList()/quickLoginWithUin`（或 QR：
  `connect()` → `getQRCodePicture()` → `onQRCodeGetPicture`/`onQRCodeLoginSucceed`）+ `init(config, depends,
  dispatcher, listener)` + `startNT(0)`
- init 完成信号：`onOpentelemetryInit(is_init===true)` 为主，`onSessionInitComplete(0)` 为辅
- appid 兜底 537237765，qua `V1_WIN_NQ_<ver>_<build>_GW_B`

**卡点**：session init 后 `getMsgService` 断言 cpp_impl invalid（9.9.31 把真实初始化下沉 C++ 层）→ 引向 V2。

**结论**：注入路线全链路可用但内存 1.01GB，不可接受 → 路线演进开始。

---

## 2. V2：Native Bypass 载具 + Ghidra 逆向（2026-08-06）

**决策背景**：9.9.31 主进程 JS 侧拿到的 session 全是无 cpp_impl 的空壳（`implementation of
IQQNTWrapperSession is not valid`）；渲染进程 contextIsolation 隔离；`RM_IPCFROM_RENDERER*` 分发器是
[native code] JS 不可调。纯 Electron JS/API 路线被完全封死。

**决策**：Native C++ Bypass 载具 + NAPI 业务层混合模式。载具 DLL 三职责：
① NOP wrapper.node 环境自检与 self-register 校验 ② 激活 session cpp_impl ③ 阻断 Chromium UI/GPU/Renderer。

**实测突破（勿重复探索）**：
- 激活链（FUN_180025d63 创建 → FUN_180025d9d 注册 → FUN_180028756 init）在 QQ 主进程内全部跑通，
  QQ 存活 9 进程无崩溃（vehicle.log 实证）；sessionId 必须是 QQ std::string（32 字节 SSO），
  注册传 shared_ptr 本体（传裸指针 0xC0000005 崩溃）
- **关键发现**：wrapper.node 的全部依赖（v8/node/napi/qq_magic）都从 QQNT.dll 常规导入 →
  **QQNT.dll 是可独立加载的宿主桥接层** → 自建宿主成为可能（引向 V3）

**红线确立（沿用至今）**：目的单一性 / 业务逻辑零逆向 / 零磁盘篡改 / 零引入 NapCat / 逆向产物不进公共仓库。

---

## 3. V3：自建宿主可行性（2026-08-06 晚）

**决策**：标准 Node 独立进程加载 QQNT.dll + wrapper.node，无 QQ 进程 → 内存对标 50-100MB。

**实测证据链**（标准 Node v24.16.0，无 QQ UI）：
1. `LoadLibrary(QQNT.dll)` 成功（提供 v8/node/napi/qq_magic 全套宿主符号）
2. `LoadLibrary(wrapper.node)` 成功（常规导入自动绑定，绕过 self-register）
3. koffi 调 `CreateNTSessionShell("Session")` → 真实对象指针（vtable RVA 0x395c068 验证）
4. 激活链 FUN_180025d63/9d/28756 全部调用成功无崩溃（最小 SessionConfig：+0x268 QQ std::string 非空、
   +0x280 char=1、+0x3f8 char=1）

**P0 修正**：`process.dlopen(wrapper.node)` 在纯标准 Node 成功（IAT hook GetProcAddress 拦
napi_register_module_v1 查询），但 **NAPI exports 无法填充**——wrapper.node 的 napi_* 绑定 QQNT.dll
定制实现，标准 Node env 不兼容 → 调真实注册函数 FUN_180b60da4 会 0xC0000005。**NapCat 能行是因为
Shell Worker 是 Electron utilityProcess（QQ env），不是纯标准 Node。**

**决策修正**：自建宿主业务层**不走 koffi C++ ABI**（违反红线），必须走 NAPI（env 兼容层方案）→ 引向 V4。

---

## 4. V4：双层路线 + P0 判定（2026-08-06 深夜）

**决策（用户拍板）**：先试「自建宿主 + env 兼容层」（优先，百兆）；验证失败则回退「NapCat 同款」
（兜底，300MB 级别）。「百兆」是目标不是死刑。

**P0-A：env 兼容层探针（✅ 成功）**：
- 改写 wrapper.node IAT 的 napi_* 槽（99/101 槽）→ 标准 Node env 函数表
- 调主注册函数 **FUN_180001000（RVA 0x1000，P0-A 实测）**→ exports 89 个 = QQ 环境完全一致
  （旧记 FUN_180b60da4 只注册 6 个 Guild 服务——已纠正）
- loginService 30 个方法全可用

**P0-B：登录链路（❌ 失败——路线 A 判死）**：
- `engine.initWithDeskTopConfig`（必须，否则 initConfig 崩）→ `initConfig` → `connect` →
  `getQRCodePicture` 表面调用全成功 ✅
- **`getLoginList` 崩溃**；QR 登录后异步轮询回调必然崩溃（QQNT.dll +0x3E1E302 事件分发对象未初始化）
- **根因**：QQNT.dll 的事件分发对象由 **QQ Electron 主进程 boot JS 创建**（进程级全局状态），
  纯 Node 无人初始化
- 已穷尽排除：IAT 模式 0/1、session 激活链、TLS isolate 注入、qq_magic_node_register

**🎯 V4 结论**：纯标准 Node 自建宿主无法完成登录 → 路线 A 判死，转路线 B。

**⚠️ 但 V5 深夜存疑（见 §5）**：判死用的是已下线的 9.9.31；NapCat 纯 Node 模式（9.9.27 + napi2native）
能跑通 → 判死可能不成立。→ 2026-08-06 文档整理时用户拍板**按「自建宿主可救」规划**（见 STATUS.md 顶部）。

---

## 5. V5：路线 B 定稿 + 全链路验证（2026-08-06）

**决策**：路线 B（NapCat 同款：注入 QQ 主进程 → utilityProcess Worker）全链路验证通过，正式落地。

**链路**：BootMain 拉起 QQ + 注入 hook DLL → boot.cjs（NAPUTO_ROUTE_B=1）→ fork utilityProcess
Worker（继承 QQ env）→ worker 内 process.dlopen(wrapper.node)（98 exports，无需 IAT 改写）→
boot-bootstrap.js 复用 → kernel 装配 → 登录 → session → 协议装配。

**为什么路线 B 胜出（当时）**：路线 A 判死（P0-B）；路线 B 的 worker 继承 QQ env，事件分发对象天然可用，
P0-B 崩溃点消失。

**P1-1/1-2/1-3（提交 0306226）**：注入 9.9.31 → electron 37.1.0 + utilityProcess 可用；worker 继承 QQ env；
QR 二维码写盘 cache/qrcode.png + URL 打印。

**P2-0（提交 c42d20d）**：① appid 动态解析（9.9.33-51802 = 537376818，硬编码 537237765 扫码失败
「请下载最新版」）② NapCat 式 session 创建（SSW.create → getNTWrapperSession("nt_1") → startupSession.start()）
③ getMsgService READY（1s）+ msgService 299 方法。

**P2-1（提交 01f9dd0 → 5ed694d → ad8a926）**：快速登录网络重试（1006511）+ 冒烟自检（NAPUTO_SMOKE=1）+
cli 默认路线 B；修正 worker 模式登录数据路径 + session 挂载方式；**路线 B 不注入 vehicle**（worker 继承
QQ env 天然带 cpp_impl，vehicle 仅无头用）。

**⚠️ 2026-08-06 深夜存疑（最重要的转折）**：
研究 `<NapCat Shell 部署包目录>`（NapCat Shell Windows 部署包）后发现 **NapCat 也有纯 Node
自建宿主模式（node.exe ./index.js），无 QQ 进程无 UI，双进程仅 ~237MB，且能登录**（部署包自带 9.9.27
资源 + napi2native bypass 库）。napi2native 真实职责是反风控/环境模拟（进程名伪装、隐藏模块、
Base_PowerMessageWindow 窗口类、数据包层 hook）——**不是 env 兼容层**。

→ **2026-08-06 文档整理决策**：按「自建宿主可救」规划，路线 B 降为兜底（详见 STATUS.md 顶部决策点）。

---

## 6. V6：功能范围 + 逆向边界拍板（2026-08-06）

**决策（用户拍板，两句话）**：
1. **不要 WebUI 和插件系统**——功能范围 = NapCat 全部能力（协议 + API）− WebUI − 插件系统
2. **允许必要逆向，非 0 逆向**——撤销「业务逻辑零逆向」红线

**逆向边界修订（AGENTS.md 第 7 条）**：
- **允许逆向的用途**：a. 环境模拟/反风控（进程名伪装、模块隐藏 K32EnumProcessModules/GetModuleHandleW、
  内存 RWX→RX、窗口类 Base_PowerMessageWindow——自建宿主必需，napi2native 自研等价物）；
  b. 数据包层 hook（Frida Gum 等价物，数据包监控/协议分析）；c. 无头阻断；d. 模拟触发 cpp_impl 激活信号
- **业务层优先 NAPI**（优先级而非禁令）：收发消息/事件监听/数据解析优先走官方 NAPI；NAPI 覆盖不了的
  能力（数据包层、环境模拟）才用 C++ 逆向补足
- **技术手段不设限**：koffi / vtable 槽位 / 内存偏移 / thiscall 裸调允许，但仅限 loader 载具层
  （版本脆弱性，不是合规问题）
- **许可证底线不变**：零引入 NapCat 代码（GPL-2.0-only 与 MIT 不兼容）；逆向产物（RVA/Offset）不进
  公共仓库

**影响**：自建宿主路线解锁（窗口类 + 反风控自研可行）；数据包层能力列入远期（对齐 NapCat packet 后端）。

---

## 7. V7~V10：自建宿主全链路定案（2026-08-07）

> 本阶段从「自建宿主验证通过」一路走到「业务基本实现」，详见各 HANDOVER-V6~V11。

### V7：自研 stub QQNT.dll 等价物（2026-08-07 早）

**决策背景**：登录链路验证依赖 NapCat 闭源 stub（481KB）——产品化前置必须自研。

**成果**：llvm-mingw 编译 **69KB PE Export Forwarding stub**，99 符号 = napi_* ×40 + uv_* ×56 +
qq_magic ×1 + v8/node mangled ×2；node.exe 缺失仅 2 个（`qq_magic_napi_register` →
`node.exe.napi_module_register`、`?IsEnvironmentStopping@node@@` → stub 内部返回 false）。
替换 NapCat stub 后登录链路验证通过。

**决策**：不再依赖 NapCat 部署包；正式版 `stub-qqnt.cpp` 放 native（闭源子仓库）。

### V8：正式版 stub + 自建宿主「硬墙」误判（2026-08-07 晚）

- `stub-qqnt.cpp` 正式化：IsEnvironmentStopping + **PerfTrace 空实现**（官方 QQNT.dll 有导出、
  NapCat stub 同款空实现实证，消除 GetProcAddress failed 日志）
- `compare-symbols.mjs` 加 PerfTrace 动态符号自动生成（def 100 条 = 99 静态 + PerfTrace）
- ⚠️ 深夜误判「自建宿主业务 service 硬墙」——session.init 后 getMsgService 不 READY，记录 V8 交接

### V9：session READY 突破（2026-08-07 深夜，决定性）

**推翻 V8 硬墙**：关键 = **`session.init(config)` 之后调 `startupSession.start()`**（NapCat
initializeSession 顺序）。此前失败原因：① 先 `ssw.start()` 再 init（顺序颠倒）② init 后用 startNT
（非 startupSession.start）。改正后 `onOpentelemetryInit(is_init=true)` 触发 → **getMsgService READY
（298 方法）+ getGroupService/getBuddyService/getTicketService/getProfileService 全部有效**。
隔离实验：O3 上报 / UUID guid / deviceConfig 均非必要。**kernel 落地**（`ea07ab4`）：
`lifecycle.initAndStartSession` 改为先 init 后 startupSession.start（有则 start()，否则 startNT 兜底）。

### V10：业务基本实现 + 自建宿主唯一路线（2026-08-07）

- **用户拍板：只保留自建宿主实现方式**，路线 B（拉起 QQ + 注入）淘汰——cli `pnpm start` 默认自建宿主（`0d9b769`）
- 自建宿主引导落地（`3a48844`）：`self-host.cjs` + `launchSelfHost` + kernel 适配（resolveQqGlobalPath /
  loginService 优先 get() / ensureLoginConnected / 自建宿主 session 先建）
- **MsgListener 签名校准**（`d253bfd`）：onRecvMsg 改为**消息数组**（运行时实证：单条签名导致
  msg.msgId/elements 全 undefined）；boot-protocols 控制台消息日志上线（NapCat 同款，独立订阅）
- **结论：业务基本实现**——kernel（12 apis + bridge + cache + login）→ adapter（onebot11 79 动作（含别名变体））→
  network/media → loader 自建宿主引导 → cli 唯一启动方式，全部落地。端到端实测：自动定位 QQ →
  登录 <测试QQ号> → session READY → 冒烟收发 → onebot11 adapter → **群消息真实接收并打印**（群「<测试群>」）

---

## 8. 已清理事项（勿重建）

- **`scripts-tmp/` 整目录已删**：含 QQ 登录票据（敏感）+ 全部探针/逆向脚本。核心逻辑均已产品化
  （appid 解析 → wrapper-config.ts；session 创建 → wrapper-loader.ts；自建宿主引导 → loader launchSelfHost（dist/host/self-host.cjs））
- `.gitignore` 保留 `scripts-tmp/` 规则（防再建临时目录泄漏）
- **onebot12 已删除**（commit ac5ebba，规范过于模糊，用户拍板放弃）；satori 已实现（2026-08-08）
- **全局配置 = 单一 TOML**（`<数据根>/napuketto.toml`，2026-08-05 用户拍板，不再用独立 JSON）；
  **2026-08-07 修订：配置文件移到项目根 `<项目根>/napuketto.toml`**（用户拍板：不喜欢东西堆用户目录），
  数据（账号目录/日志/缓存/QQ 数据）仍按数据根组织；路径解析 kernel `resolveConfigPath`（
  NAPKETTO_CONFIG 显式 > 项目根探测 > cwd > 数据根兜底）

---

## 9. 决策史知识点索引

| 想查什么 | 去哪看 |
|---|---|
| 当前路线 / 自建宿主存疑 / 验证实验 | `docs/STATUS.md` 顶部 |
| 架构分层 / 红线 / 技术路线 | `docs/architecture.md` |
| 各包模块设计 / 实现记录 | 对应包 `docs/design.md` |
| P0/P1/P2 实验细节（历史） | git 历史归档提交 `d9a790e` 前的 HANDOVER-V2~V5 |
| GhidraMCP 工具用法 | `packages/loader/native/docs/ghidra-mcp-guide.md`（闭源子仓库，2026-08-07 移入） |
