# @napuketto/kernel

## 0.0.14

### Patch Changes

- 19baba2: fix(kernel): 修复 sendMsg 失败导致子进程崩溃（unhandledRejection）

  `MsgApi.sendMessage` 中若 `service.sendMsg` 抛错（wrapper 内部异常），已注册的
  `confirmSend` 确认 Promise 无人消费，随后 `onMsgInfoListUpdate` 确认事件
  （sendStatus=0）触发 `reject` 时变成 unhandledRejection，Node 默认抛错退出，
  直接拖垮整个子进程并连带 IPC 通道关闭。现预消费 confirm 的 rejection 兜底，
  失败语义不变。loader self-host 同步加 unhandledRejection 日志兜底（不退出），
  防止同类漏网 rejection 再拖垮进程。

## 0.0.13

### Patch Changes

- 426cf43: refactor(kernel): msg 富媒体元素裸魔数抽常量并补注释（纯重构，行为零变化）

## 0.0.12

### Patch Changes

- abbde2f: fix(kernel/loader): wrapper 配置硬编码治理——major.node 解析 appid 失败时显式抛 KernelError（删除 537237765 静默兜底，该 appid 属已下线登录服务的 9.9.31），系统信息改为运行时探测（os.release/version/platform，不再写死 Windows 构建号），engine/session 配置裸魔数抽为具名常量并补契约注释。

## 0.0.11

### Patch Changes

- 555e284: fix(kernel/loader): device guid 填空——LoginService 实测为 getMachineGuid（无 getMachineId 方法），kernel 新增 readMachineGuid 原生反射读取，buildSessionConfig 接入 machineGuid，loader 引导时传入设备指纹 guid（反风控）。
- ebc59b5: feat(kernel/loader): IPC control login 指令实现——kernel 新增 qrOnly 登录选项（强制扫码跳过快速登录），loader ipc-server handleControl 接入 login 分支（uin 指定账号 / qr 强制扫码），koishi 插件可经 control login 触发重新登录而不重启子进程。

## 0.0.10

### Patch Changes

- 98c27a3: feat(kernel): QR 登录暴露手动刷新句柄 + 120s 登录超时（复刻 bilibili-dm 扫码交互）

  - `NapukettoCore` 新增 `refreshQr(): boolean`——登录期间持有 `qrSession` 句柄，
    供 koishi 前端「刷新二维码」按钮经 IPC 直达，不再重启子进程
  - `QrLoginSession` 新增 120s 登录超时（照搬参考项目 60×2s）：出码后计时，
    超时未登录 → `failed` + `failureReason`「登录超时，请刷新页面重试」；
    每次 `refresh()` 重置计时，登录成功/失败/stop 清理
  - `LoginProgress` 新增可选 `message`（failed 态失败原因，经 IPC 透出）

## 0.0.9

### Patch Changes

- 9b031ea: 修复：QR 登录快速登录回退逻辑——`quickLoginWithUin` 失败时是 **resolve 带 `loginErrorInfo.errMsg`**（wrapper 契约，非 reject），原实现只挂 `.catch` 导致无登录凭据环境（如 WSL 扫码登录）下回退永不触发：二维码永不产生、完全静默阻塞（无日志无事件）。现改为检查 resolve 结果的 `errMsg` 再回退 `getQRCodePicture()`；同时 `loginByQr` 不再透传 `quickUin`（QR 回退路径下快速登录已失败过一次，二次快速登录在无凭据环境白等一个周期）。

## 0.0.8

### Patch Changes

- c60c34c: 修复：对外 API 新增 CJS 双格式产物（`dist/index.cjs`），`exports.require` 指向 `.cjs`——此前仅发布 ESM（`.mjs`），koishi 适配器（发布形态为 CJS，koishi loader 用 `require()` 加载插件）require kernel/loader 时抛 `ERR_REQUIRE_ESM`，导致适配器无法加载。ESM 消费方（apps/cli 自建宿主）不受影响，仍走 `import` → `.mjs`。

## 0.0.7

### Patch Changes

- 42a9786: fix(kernel): 修复语音发送失败与进程崩溃重启（PTT 元素 NapCat 式预处理）

  此前 `toSendElements` 对 voice 元素只传 `{ filePath }`，wrapper 内部转换 pttElement
  时缺字段抛 "Cannot convert undefined or null to object"，且发送后进程崩溃
  （supervisor 自动重启）。现实现 `preparePttElement`：md5/文件大小计算 →
  `getRichMediaFilePathForGuild` → `util.copyFile` 放置 → 完整 pttElement
  （md5HexStr/fileSize/duration/formatType/voiceType/canConvert2Text/waveAmplitudes
  等，与 PIC 预处理同构）。非 silk 输入（ogg/amr 等）由 wrapper 内部转码，
  实测语音发送成功（sendStatus=2 + 真实 fileUuid）。

## 0.0.6

### Patch Changes

- d6f4b56: refactor(kernel): fallow 健康度重构——43 个 CRAP 超标函数降至 9（行为等价，2026-08-09）

  - **降复杂度**：`wrapper-loader`（startNapuketto/createSession/startSession 回退链拆分）、
    `session-resolver`（findMainSessionId 统一 firstStringId）、`probe` 探测子系统
    （probeStartup/probeSession/enumerateSessionIds 拆小函数）、`login-connect`
    （attemptQuickLogin 提取重试单次）、`lifecycle`（watchInitSignal/startSessionBestEffort）、
    `core`（initLoginConfig/resolveCommonPath/waitQrLoggedIn）、`webapi`（honorTargets
    映射表替代 if 链）、`stranger-info`（pickField 字段级回退）、`group/msg/friend/richmedia`
    （extractGroupDetail/findPttElement/findForwardElement/toDoubtFriendRequestInfo 等纯函数提取）
  - **补测试**（12 个新测试文件，201 → 454 用例全绿）：wrapper-loader / session-resolver /
    probe-utils / event-channel / login-connect / group-cache / wrapper-version /
    wrapper-config / group / friend / msg / richmedia 的 mock 基线测试
  - 全部为行为等价重构（无 API 变化），`pnpm check` / 454 测试 / 全量构建全绿

- f744cf7: fix(kernel): 修复图片发送失败（PIC 元素 NapCat 式预处理：elementType=2 + getRichMediaFilePathForGuild + copyFile + 完整 picElement）
- 769d457: fix(kernel): 修复消息发送失败（sendMsg 返回 result=5 被误判失败）

  问题根因：旧实现以 `sendMsg(msgId, peer, ...)` 调用并直接看返回值 `result===0` 判成败，
  但 wrapper 对正确调用返回 `result=5`（文本/图片均失败）。按 NapCat 同款方式修复：

  - sendMsg 第一参固定传 `'0'`，msgId 塞 `peer.guildId`
  - 先注册 `onMsgInfoListUpdate` 事件监听再调 sendMsg，以事件 `sendStatus===2` 确认发送成功
    （sendMsg 返回值 result 非 0 不立即判失败——富媒体异步上传时 result=5 常见）
  - `MsgBridge` 补注册 `onMsgInfoListUpdate` 回调（此前缺失，发送状态事件不透传）
  - `MsgApi` 构造支持注入消息事件通道；无通道时退化为旧行为

  实测：文本消息成功发送到群（boot 日志确认）；图片发送错误从模糊的
  `rich media transfer failed` 变为清晰的 `sendStatus=0`（图片仍失败，根因另查）。

## 0.0.5

### Patch Changes

- d6f4b56: refactor(kernel): fallow 健康度重构——43 个 CRAP 超标函数降至 9（行为等价，2026-08-09）

  - **降复杂度**：`wrapper-loader`（startNapuketto/createSession/startSession 回退链拆分）、
    `session-resolver`（findMainSessionId 统一 firstStringId）、`probe` 探测子系统
    （probeStartup/probeSession/enumerateSessionIds 拆小函数）、`login-connect`
    （attemptQuickLogin 提取重试单次）、`lifecycle`（watchInitSignal/startSessionBestEffort）、
    `core`（initLoginConfig/resolveCommonPath/waitQrLoggedIn）、`webapi`（honorTargets
    映射表替代 if 链）、`stranger-info`（pickField 字段级回退）、`group/msg/friend/richmedia`
    （extractGroupDetail/findPttElement/findForwardElement/toDoubtFriendRequestInfo 等纯函数提取）
  - **补测试**（12 个新测试文件，201 → 454 用例全绿）：wrapper-loader / session-resolver /
    probe-utils / event-channel / login-connect / group-cache / wrapper-version /
    wrapper-config / group / friend / msg / richmedia 的 mock 基线测试
  - 全部为行为等价重构（无 API 变化），`pnpm check` / 454 测试 / 全量构建全绿

## 0.0.4

### Patch Changes

- fix: 包 exports 增加 require/default 条件——`@napuketto/*` 被 koishi 插件（CJS 产物）作 dependencies 消费时，`require('@napuketto/kernel')` 此前因 exports 仅声明 `import` 条件而报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。补 `require`/`default` 条件指向同一 `.mjs`（无顶层 await，Node 22.12+ require(esm) 原生同步加载）；插件发布链自动追踪新版本

## 0.0.3

### Patch Changes

- fix(kernel): 群列表数据源校准（2026-08-08，e27fb55）——原生 getGroupList 返回值无数据（仅 `{ result, errMsg }`），列表实际经 onGroupListUpdate 事件推送；GroupCache 新增 listGroups / listGroupsRefreshed；IPC 动作表与 OB11 / Satori 群列表动作改从缓存读，force / no_cache 触发原生刷新

## 0.0.2

### Patch Changes

- 564e383: Barrel 规范化整理（纯结构重构，行为零变化，2026-08-08）：

  - **kernel**：`infra/`、`types/`（含 `listeners/`、`services/` 子 barrel）、`login/`、
    `bridge/`、`apis/` 各建 `index.ts` barrel；`index.ts` 与全 kernel 跨目录引用改走 barrel，
    同目录组内引用保持相对路径（`./result.js` 等）
  - **adapter**：`onebot11/action/index.ts` 升级为真正 barrel（re-export 全部 79 个动作类 +
    error-map + resolve-uid + Ob11ActionDeps + createOb11ActionRegistry）；`onebot11/api/`、
    `satori/api/` 单文件建统一入口；`satori/helper/` 建 barrel（config/error/ids/translate，
    element 子域独立 barrel 不绕行）
  - 包对外 API 签名不变（`packages/*/src/index.ts` 导出面未动）；`.fallowrc.jsonc`
    按 codec/element 先例补充新 barrel 的 ignoreFindings（目录公共面 re-export）

  `pnpm check` / 59 测试 / 全量构建 / fallow（dead files 0%、dead exports 0%）全绿。

- b9f06ca: DDD 目录重组（纯移动 + barrel，行为零变化，2026-08-08）：

  - **kernel**：`wrapper/` 拆出 `wrapper/probe/`（运行时反射探测子系统 5 文件 + barrel）；`index.ts` 改指 probe barrel
  - **adapter**：`satori/helper/` 拆出 `helper/element/`（消息元素域 7 文件 + barrel：解析/渲染/双向转换/资源）；`onebot11/helper/` 拆出 `helper/codec/`（CQ 编解码域 3 文件 + barrel）
  - **loader**：`host/` 拆出 `host/core/`（自建宿主引导编排 7 文件）；tsdown 入口与 `.fallowrc` manual entry 同步改 `host/core/self-host.ts`（产物 `dist/host/self-host.cjs` 路径不变，launcher 默认值无需改）

  全部为 git mv 文件移动 + import 路径调整（组内相对引用保持，跨目录走 barrel），`pnpm check` / 59 测试 / 全量构建 / fallow 全绿，无 API 变化。

- 8e64508: 按 fallow 建议重构 4 个 untested-risk 目标（先建 vitest 测试设施写基线，重构后回归）：

  - **测试设施**：根 `vitest.config.ts` + `pnpm test`（59 用例覆盖 4 个重构模块）
  - **kernel/result.ts**：unwrapResult 错误码映射链 → `RESULT_CODE_RULES` 查找表 + `mapResultCode` 纯函数（cyclomatic 10 → 4）
  - **kernel/probe-serialize.ts**：serialize 分支拆 `serializeContainer`/`serializeArray`/`serializeMap`/`serializeSet`/`serializeObject`（cyclomatic 16 → 6）
  - **adapter/segment.ts**：canonicalToSegment/segmentToCanonical if 链 → 判别式转换器映射表（cyclomatic 12/11 → 1/2）
  - **adapter/element-convert.ts**：elementToCanonical switch → 元素转换器映射表；媒体元素转换器（img/audio/video/file）拆分到 `media-convert.ts`

  全部为行为等价重构（59 测试回归通过，无 API 变化）。

- 9005c43: koishi 适配器 IPC 子进程模式前置（§7 loader 去脚本化，2026-08-08）：

  - **kernel**：`NTEventChannel` 新增 `onAny`（全事件订阅，IPC 整通道转发用）；
    `CoreLoginOptions` 新增 `onLoginProgress` 回调（QR 阶段二维码/状态机转发）；
    `LoginProgress` 类型导出
  - **loader**：新增 `src/host/ipc/`（NAPUTO_IPC=1 开启）——协议类型/编解码/发送封装/
    动作表（msg/group/friend 核心动作，peerUin 自动转 uid）/stdin 服务端（action/control/
    心跳）；`self-host.ts` IPC 分支发 status（booting→dlopening→logging→sessioning→ready/
    failed）；`protocols.ts` 重构拆出 `kernel-services.ts`（服务创建，IPC/协议共用）+
    `assemble-protocols.ts`（OB11/Satori 装配，非 IPC 零回归）；`launcher.ts` 新增
    `LaunchOptions.ipc`（注入 NAPUTO_IPC=1）

  非 IPC 路径（cli pnpm start）行为零变化；`pnpm check` / 198 测试全绿。
