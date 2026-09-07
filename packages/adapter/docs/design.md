# @napuketto/adapter 设计书（2026-09-08 首版：覆盖 onebot11 事件链 / onReload / get-media / satori 媒体）

> 协议适配器容器（ADR-013）：core 框架（BaseProtocolAdapter/ActionRegistry/
> ProtocolConfig）+ onebot11 + satori。只认识 kernel 的 API/事件/缓存，不认识
> 原生（红线）。本文覆盖 2026-09-08 接线轮次动到的模块；79 动作注册表 /
> CQ 码 / 传输装配等既有结构见源码与 `docs/architecture.md`。

## 1. onebot11 事件链（adapter.ts 订阅 + helper/ 翻译）

```
kernel 通道                          adapter 订阅                    翻译（纯函数）          → broadcaster
Msg/onRecvMsg                    →  subscribe()                 →  message-event / notice    → OB11 事件
Group/onGroupNotifiesUpdated     →  subscribe()（2026-09-08）    →  request.ts               → request 事件（group_add/invite）
Buddy/onBuddyReqChange           →  subscribe()（2026-09-08）    →  request.ts               → request 事件（friend）
Buddy/onBuddyListChange(dV2)     →  subscribe()（2026-09-08）    →  仅 raw 校准日志（形状未知，不翻译）
```

- **request 事件**（`helper/request.ts`）：
  - GroupNotify → group request：type 1/5=invite、7=add（与 get_group_system_msg
    动作同一解释）；仅未处理状态（KUNHANDLE）推送；flag = seq（与
    set_group_add_request 的 `item.seq === flag` 匹配路径一致）。
  - BuddyReq → friend request：`narrowBuddyReqs` 防御性收窄（`BuddyReq[]` /
    `{buddyReqs}`；未知形状打 raw 日志）；flag = reqTime；comment 取 words
    字段（形状待校准）。
  - doubt 可疑群通知跳过（与 set_group_add_request 的先非可疑后可疑匹配序一致）。
- **notice 补全**（`helper/notice.ts`，2026-09-08）：
  - friend_recall：C2C grayTip REVOKE。
  - notify.poke：aioOpGrayTipElement——**待真实事件验证**（口径：user_id=发送者，
    target_id=aioOp.peerUid，group_id=群号/C2C 0；poke 路径始终打 raw 日志）。
  - 未知/未翻译 grayTip 子类型（JSON/BUDDY/ESSENCE/GROUP_NOTIFY/FILE 等）打
    raw JSON 校准日志（friend_add / lucky_notify / honor / essence 翻译的
    数据源积累入口）。
- **校准 logger**：`OneBot11AdapterOptions.logger`（warn/info 最小面），
  装配方传 pino 实例；缺省静默。
- **gap 清单**（源事件缺失或改报形式有风险，未翻译）：group_upload（文件消息
  现以 message 事件 + file 段透出，改 notice 影响现网 koishi 收向，待拍板）、
  group_card / offline_file / group_sign / msg_emoji_like / group_title（无对应
  kernel 事件源）、friend_add（源存在但 payload 未知，raw 日志积累中）。

## 2. onReload 热更新（2026-09-08 实现，P2-6 兑现）

`BaseProtocolAdapter.reload()` = `config.reload()`（重读文件）→ `onReload(config)`：

- **onebot11**：`reloadTransports`——stopAll（心跳/退订/传输关闭）→
  startTransports（新配置装配 + lifecycle enable + 心跳）。
  **IPC 桥模式**（subscribeOnly，subscribedOnly 标记）无传输不重建，仅刷新
  reportSelfMessage / messagePostFormat。
- **satori**：stopAll（广播 login-updated 离线）→ startTransports（新配置装配，
  广播在线）。无 IPC 桥模式，恒走重建。

## 3. get_image / get_record（action/message/get-media.ts，2026-09-08 接主动下载）

- **本地解析**：NT 相对路径（sourcePath/filePath）按 `mediaBaseDir`（QQ NT
  global 目录）解析绝对路径，磁盘命中即返回 file。mediaBaseDir 由装配方
  （loader assemble-protocols / ipc-ob11）经 `resolveQqUserDataRoot` +
  `resolveQqGlobalPath` 从 wrapper util 解析注入（失败缺省——仅 URL 下载路径）。
- **图片主动下载**：本地未命中且有 picUrl → `@napuketto/media downloadUrl`
  落 `cacheDir/media/`，返回 file（绝对路径）+ url + file_size/file_name；
  失败回退 url-only（不抛错）。
- **语音缺口**：无 URL 可下载，本地未命中返回原始 NT 相对路径 +
  元数据——原生 downloadRichMedia 签名未探测，待 T10 实测后接入。

## 4. satori 媒体（helper/element/media-convert.ts）

- video 非 mp4 输入 → `@napuketto/media transcodeVideo`（ffmpeg H.264 归一化，
  exitCode/产物校验）→ 失败/缺 ffmpeg fail-soft 原样透传。mp4 直通不转码。
- audio 已有 ensureSilk（非 silk 转码）不变。

## 5. media 包依赖面（ADR-011）

adapter 依赖 `@napuketto/media`（encodePcmToSilk / decodeSilkToWav /
transcodeVideo / downloadUrl / inferExtension）。kernel 不依赖 media。

## 6. 已知缺口（下一轮）

- 语音主动下载（原生 downloadRichMedia）。
- poke 翻译字段校准（首次真实事件后）。
- friend_add 翻译（Buddy 列表变化 payload 校准后）。
- group_upload 是否改 notice 报形式（待用户拍板，见 §1 gap 清单）。
