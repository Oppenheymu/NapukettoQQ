# @napuketto/loader

## 0.0.17

### Patch Changes

- abbde2f: fix(kernel/loader): wrapper 配置硬编码治理——major.node 解析 appid 失败时显式抛 KernelError（删除 537237765 静默兜底，该 appid 属已下线登录服务的 9.9.31），系统信息改为运行时探测（os.release/version/platform，不再写死 Windows 构建号），engine/session 配置裸魔数抽为具名常量并补契约注释。

## 0.0.16

### Patch Changes

- 555e284: fix(kernel/loader): device guid 填空——LoginService 实测为 getMachineGuid（无 getMachineId 方法），kernel 新增 readMachineGuid 原生反射读取，buildSessionConfig 接入 machineGuid，loader 引导时传入设备指纹 guid（反风控）。
- ebc59b5: feat(kernel/loader): IPC control login 指令实现——kernel 新增 qrOnly 登录选项（强制扫码跳过快速登录），loader ipc-server handleControl 接入 login 分支（uin 指定账号 / qr 强制扫码），koishi 插件可经 control login 触发重新登录而不重启子进程。

## 0.0.15

### Patch Changes

- 5bb12a5: feat(loader): IPC 协议契约改为 zod 单一来源——loader 导出 IpcMessageSchema 与全部协议类型（替代 koishi 侧 src/ipc/types.ts 手工镜像，消除两侧类型漂移），新增 zod 依赖；ipc-codec 解码改用 IpcMessageSchema.safeParse（顺带校验 payload 形状，非法 payload 在边界即拦截）。koishi 适配器同步改为消费该契约。

## 0.0.14

### Patch Changes

- fa86aef: fix(loader): Linux 7zz 内置资产优先（治本）+ 版本 2409→2501（止血）

  生产环境 7z 下载 404 根因：7-Zip 官网只保留最新版 tar.xz，硬编码 2409 已被删档
  （实测 404，2501 为当前版）。治本：7zz 静态二进制（2.8MB，LGPL 合规）打进发布包
  `assets/7zip/`（与 Windows 7z.exe 同模式，含 License-linux.txt），`ensureLinuxSevenZip`
  优先级改为 内置资产 > 数据根缓存 > 官网下载兜底（NAPUTO_7Z_URL 可覆盖）——Linux
  引导链不再依赖运行时外网下载 7z。`findSevenZip` 同步支持 Linux 内置资产。
  QQ 安装包保持动态下载（qq-releases.json 清单 + NAPUTO_QQ_URL 覆盖，不变）。

## 0.0.13

### Patch Changes

- f42a50c: 修复 WSL/Linux 生产环境两个问题：① wine 场景 PATH 混入 Unix 路径（冒号分隔）导致 stub QQNT.dll 目录被拆散、wrapper.node 依赖的 QQNT.dll 找不到——PATH 逐条转 Z:\\ 纯 Windows 风格；② Linux 缺少 7z（内置资产是 Windows PE，系统未装 p7zip-full）导致 QQ 安装包解包失败——自动下载 7-Zip 官方 Linux 版 7zz 到数据根 runtime/7zip。

## 0.0.12

### Patch Changes

- 98c27a3: feat(loader): IPC 服务端登录前提前启动 + login.refreshQr 动作

  - 登录前即启动 stdin 服务端（动作表先只含 `login.refreshQr`）——原实现在登录成功
    - 协议装配后才启动，登录中（waiting_scan）前端刷新/control 指令堆积在 pipe
      缓冲区不可达；心跳 ping（15s）同步提前，防扫码耗时超过 45s 被 driver 误判失联强杀
  - 登录后 `attachIpcServices` 把 kernel 服务动作并入同一张共享动作表 + 事件转发
    （`startIpcMode` 拆分为 `createIpcActionsForCore` + `attachIpcServices`）
  - `IpcLoginPayload` / `sendLogin` 新增可选 `message`（失败原因透出）

## 0.0.11

### Patch Changes

- 5d4524f: fix(loader): WSL 下 QQ 安装定位——常见路径探测支持 `/mnt/<盘符>/` 挂载映射，installDir 推导改用 `dirname`（原反斜杠切分在 Linux 路径下切错字符）

## 0.0.10

### Patch Changes

- c60c34c: 修复：对外 API 新增 CJS 双格式产物（`dist/index.cjs`），`exports.require` 指向 `.cjs`——此前仅发布 ESM（`.mjs`），koishi 适配器（发布形态为 CJS，koishi loader 用 `require()` 加载插件）require kernel/loader 时抛 `ERR_REQUIRE_ESM`，导致适配器无法加载。ESM 消费方（apps/cli 自建宿主）不受影响，仍走 `import` → `.mjs`。

## 0.0.9

### Patch Changes

- affab05: feat(loader): QQ 官方安装包自动下载解包缓存（P1，本机无 QQ 场景可用）

  - `qq-releases.json` 版本清单（含 9.9.33-51802 实测 sha256）
  - `qq-download.ts`：https 下载 + sha256 校验（零第三方依赖，NAPUTO_QQ_URL 可覆盖）
  - `qq-extract.ts`：完整版 7z 解 NSIS 安装包 + 提取 resources/app 顶层 `*.node`/`*.dll`（内置 assets/7zip，LGPL 合规；真实 QQNT.dll 由 stub 替代无需提取）
  - `ensureQqFiles()`：下载 → 校验 → 解包 → 提取 → 缓存，幂等（缓存命中直接返回）
  - `resolveQqFiles()` 改 async，L0/L1/L2 全部缺失时自动进入下载流程

- fa2fb7c: feat(loader): QQ 原生文件多级来源定位（P0 跨平台前置）

  新增 `resolveQqFiles()`：L0 `NAPUTO_QQ_FILES` 显式文件根 → L1 本机 QQ 安装（既有逻辑保留）→ L2 数据根缓存 `<数据根>/qq-files/<版本>/` 依次探测，为「本机无 QQ / Linux / Docker」场景铺路；`QqInstallInfo` 新增 `source: "local" | "cached"` 字段。`resolveQqInstall` 旧签名保留兼容。

- 3507cdd: feat(loader): Linux/wine 完整链路登录冒烟脚本（P2 Step 2）

  - `scripts/wine-login-smoke.mjs`：WSL2 一键完整链路冒烟——确保 QQ 文件 → 确保 Windows 版 node.exe → wine 跑 win-node 执行 self-host.cjs（dlopen wrapper.node → O3MiscService 激活 → 登录 → session READY → 协议装配），`--uin` 指定快速登录账号，90s 观察窗口
  - 环境变量装配与 launcher.buildLaunchEnv 同构，路径全部过 toWinePath（Z:\ 视角）

- 52c1519: feat(loader): Linux/wine 平台分支（P2 纯逻辑层）——toWinePath 路径映射 + win-node 下载

  - `wine.ts`：`toWinePath()` Linux 路径 → wine `Z:\` 路径（幂等，含盘符保护）+ `buildSpawnCommand()` 平台分支（win32 本机 node / linux wine）
  - `win-node.ts`：`ensureWinNode()` 下载 Windows 版 node.exe（nodejs.org 官方 zip → 7z 解压 → 缓存，幂等；NAPUTO_WIN_NODE_PATH/NAPUTO_WIN_NODE_VERSION 可覆盖）
  - `launcher.ts`：`launchSelfHost` 变 async，linux 场景自动走 wine + win-node，传给子进程的所有路径过 toWinePath；win32 行为不变
  - cli `boot.ts` 适配 async 调用
  - 新增 `wine.test.ts`（9 单测：toWinePath 5 + buildSpawnCommand 3 + wineBinary 1）

- de622f5: feat(loader): Linux/wine 冒烟脚本 + 实测验证记录（P2 Step 1 固化）

  - `scripts/wine-smoke.mjs`：WSL2 一键冒烟——确保 QQ 文件（P1 自动下载解包）→ 确保 Windows 版 node.exe（P2）→ wine 跑 win-node → dlopen wrapper.node → 断言 98 exports
  - 实测验证通过（2026-08-12 WSL2）：wine 跑 Windows node.exe ✅ / stub QQNT.dll PE 转发在 wine 下生效 ✅ / dlopen wrapper.node 98 exports ✅
  - 设计文档 §3.3 记录实测坑：**wine 读 DrvFS（/mnt/c）会 "File not found"，QQ 文件必须放 ext4**（Docker 无此问题）；dlopen 参数形态 `const m={exports:{}}; process.dlopen(m, ...)`

## 0.0.8

### Patch Changes

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

## 0.0.7

### Patch Changes

- fix: 包 exports 增加 require/default 条件——`@napuketto/*` 被 koishi 插件（CJS 产物）作 dependencies 消费时，`require('@napuketto/kernel')` 此前因 exports 仅声明 `import` 条件而报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。补 `require`/`default` 条件指向同一 `.mjs`（无顶层 await，Node 22.12+ require(esm) 原生同步加载）；插件发布链自动追踪新版本

## 0.0.6

### Patch Changes

- 3265791: feat(cli): 终端渲染登录二维码——loader 在自建宿主（非 IPC）模式经 `NAPUTO_QR` 标记行向 stdout 透出二维码数据，cli `forwardFiltered` 解析后用 qrcode 包渲染终端二维码（png 落盘与 URL 提示保留）；顺带移除未使用的 picocolors 依赖

## 0.0.5

### Patch Changes

- ba49012: fix(loader): IPC 动作表群聊 peer 解析——peerUin 直通为 peerUid，不再经 uinToUid 转换（getUidByUins 是用户转换 API，传群号属非法调用，QQ 原生内部抛 `Cannot read properties of undefined (reading 'service')`）；错误响应同时落 boot 日志（含完整堆栈）便于诊断

## 0.0.4

### Patch Changes

- fix(kernel): 群列表数据源校准（2026-08-08，e27fb55）——原生 getGroupList 返回值无数据（仅 `{ result, errMsg }`），列表实际经 onGroupListUpdate 事件推送；GroupCache 新增 listGroups / listGroupsRefreshed；IPC 动作表与 OB11 / Satori 群列表动作改从缓存读，force / no_cache 触发原生刷新

## 0.0.3

### Patch Changes

- b9f06ca: DDD 目录重组（纯移动 + barrel，行为零变化，2026-08-08）：

  - **kernel**：`wrapper/` 拆出 `wrapper/probe/`（运行时反射探测子系统 5 文件 + barrel）；`index.ts` 改指 probe barrel
  - **adapter**：`satori/helper/` 拆出 `helper/element/`（消息元素域 7 文件 + barrel：解析/渲染/双向转换/资源）；`onebot11/helper/` 拆出 `helper/codec/`（CQ 编解码域 3 文件 + barrel）
  - **loader**：`host/` 拆出 `host/core/`（自建宿主引导编排 7 文件）；tsdown 入口与 `.fallowrc` manual entry 同步改 `host/core/self-host.ts`（产物 `dist/host/self-host.cjs` 路径不变，launcher 默认值无需改）

  全部为 git mv 文件移动 + import 路径调整（组内相对引用保持，跨目录走 barrel），`pnpm check` / 59 测试 / 全量构建 / fallow 全绿，无 API 变化。

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

## 0.0.2

### Patch Changes

- 007e1ac: fallow 静态分析优化（克隆清零）：提取 `createWsServerSchema` 传输工厂（OB11/Satori 共用骨架，消除 config schema 克隆）；清理 4 处纯透传无用构造器（delete/set-essence-msg、satori guild.approve/member.approve）；loader smoke.ts 收敛重复文本提取逻辑为 `extractTexts` helper。
- 69a53e5: 启动单实例检测（根治多实例抢数据目录锁挂起）：同一账号数据目录（`~/.napuketto/<uin>`）只允许一个实例运行——QQ 原生层（MMKV/登录单例）有锁，第二个实例抢不到会卡在登录初始化后无响应。新增 `instance.lock` 数据目录锁（loader 包）：cli 启动前预检（占用则快速失败并提示占用 PID），self-host 子进程入口兜底获取/释放锁；崩溃残留（PID 已死）自动接管。
