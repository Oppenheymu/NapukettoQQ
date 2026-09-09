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
Msg/onRecvOfflineFileMsg         →  subscribe()（c3，2026-09-10）→  notice-extra.ts          → offline_file notice
Msg/onRecvSysMsg                 →  subscribe()（c3，2026-09-10）→  仅 raw 校准日志（protobuf 字节，待解码）
Msg/onRecvOnlineFileMsg          →  subscribe()（c3，2026-09-10）→  仅 raw 校准日志（OB11 无对应类型）
Group/onGroupEssenceListChange   →  subscribe()（c3，2026-09-10）→  仅 raw 校准日志（group_essence 候选源）
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
    **手动触发指引（校准用）**：需另一个 QQ 号在群里/私聊戳机器人账号
    （手机 QQ「戳一戳」或群内双击头像戳一戳），产生的 aioOp grayTip 会打
    `ob11: poke grayTip raw（待真实事件校准）` raw 日志——日志去向：
    IPC 模式（koishi）落 `<cfgDir>/logs/loader.log`；cli 模式仅 console
    （boot 转发终端输出）。拿到 raw 后校准 toPoke 的 user_id/target_id/
    group_id 口径并移除「待验证」标注。
  - friend_add（B2，2026-09-08）：数据源 = kernel `BuddyCache` 快照 diff
    （`Buddy/onBuddyListChange` 全量快照，T10 实证 = BuddyCategory[]，
    明细在 category.buddyList；首帧只建 baseline 不发事件）→
    `BuddyCache/onBuddyAdded` → `toFriendAdd`（user_id = coreInfo.uin）。
    diff/baseline 在 kernel 缓存层，adapter 翻译纯函数；onBuddyRemoved
    仅维护缓存（OB11 无 friend_remove 通知类型，不翻译）。
  - group_upload（B4，2026-09-08）：配置开关 `groupUploadAsNotice`
    （默认 false）。false = message 事件 + **file 段透出**（go-cqhttp 兼容；
    代码考古发现此前 file 元素被静默丢弃——转换表无 file 键，本版本起补齐，
    属修复而非行为变更）；true = 含 fileElement 的群消息改报 group_upload
    notice（user_id + file{id=fileUuid, name, size, busid=102}）替代
    message 事件。onRecvMsg 分支判定在 adapter.ts（grayTip → 文件开关 →
    reportSelfMessage → message）。
  - 未知/未翻译 grayTip 子类型（JSON/BUDDY/ESSENCE/GROUP_NOTIFY/FILE 等）打
    raw JSON 校准日志（lucky_notify / honor / essence 翻译的
    数据源积累入口）。
- **校准 logger**：`OneBot11AdapterOptions.logger`（warn/info 最小面），
  装配方传 pino 实例；缺省静默。
- **c3 扩展源（2026-09-10，`helper/notice-extra.ts`）**：五无源事件探测轮产物
  （证据矩阵见 kernel design.md §1「c3 新接线」）：
  - **offline_file**：源 = kernel `Msg/onRecvOfflineFileMsg`（字符串簇 + RTTI
    强证据）。翻译 = `narrowOfflineFiles` 防御性收窄（RawMessage 型
    elements[].fileElement / 专用实体型 fileName 顶层或 fileInfo 嵌套；未知
    形状返回 null 打 raw 日志）→ `toOfflineFileNotice`（user_id + file
    {name, size, url}）。payload 真实形状待校准——收窄口径固化在单测，
    校准后回填。
  - **group_card / group_title / group_sign**：载体 = `Msg/onRecvSysMsg`
    （sys msg 总闸，运行时实触，payload = **原始 protobuf 字节**）。当前仅
    raw 校准日志；protobuf 解码 + type/subType → notice 映射是下轮工作。
  - **msg_emoji_like**：无推送回调（API 面 getMsgEmojiLikesList 存在），
    无源可接，待观测（疑经 onMsgInfoListUpdate）。
  - **group_essence（清单外）**：`Group/onGroupEssenceListChange` raw 校准
    日志（精华事件的候选直达源，与 grayTip ESSENCE 子类型双路积累）。
- **gap 清单**（源事件缺失或改报形式有风险，未翻译）：group_upload（文件消息
  现以 message 事件 + file 段透出，改 notice 影响现网 koishi 收向，待拍板）、
  group_card / group_title / group_sign（源已接线 = Msg/onRecvSysMsg，等
  protobuf 解码）、msg_emoji_like（无推送源）、offline_file（已翻译，payload
  待真实事件校准）、friend_add（源存在但 payload 未知，raw 日志积累中）。

## 2. onReload 热更新（2026-09-08 实现，P2-6 兑现）

`BaseProtocolAdapter.reload()` = `config.reload()`（重读文件）→ `onReload(config)`：

- **onebot11**：`reloadTransports`——stopAll（心跳/退订/传输关闭）→
  startTransports（新配置装配 + lifecycle enable + 心跳）。
  **IPC 桥模式**（subscribeOnly，subscribedOnly 标记）无传输不重建，仅刷新
  reportSelfMessage / messagePostFormat。
- **satori**：stopAll（广播 login-updated 离线）→ startTransports（新配置装配，
  广播在线）。无 IPC 桥模式，恒走重建。

## 3. get_image / get_record（action/message/get-media.ts，2026-09-08 接主动下载；B1 语音原生下载）

- **本地解析**：NT 相对路径（sourcePath/filePath）按 `mediaBaseDir`（QQ NT
  global 目录）解析绝对路径，磁盘命中即返回 file。mediaBaseDir 由装配方
  （loader assemble-protocols / ipc-ob11）经 `resolveQqUserDataRoot` +
  `resolveQqGlobalPath` 从 wrapper util 解析注入（失败缺省——仅 URL 下载路径）。
- **图片主动下载**：本地未命中且有 picUrl → `@napuketto/media downloadUrl`
  落 `cacheDir/media/`，返回 file（绝对路径）+ url + file_size/file_name；
  失败回退 url-only（不抛错）。
- **语音主动下载（B1，2026-09-08）**：本地未命中 → kernel
  `MsgApi.downloadPtt`（原生 `msgService.downloadRichMedia` 单参对象
  {msgId, elemId, chatType, downloadType:2, thumbSize:0} → 轮询
  getMsgsByMsgId 等 filePath/transferStatus 就绪，约 10s 超时）→ 落盘后
  返回 file 绝对路径；下载失败回退现状（原始 filePath + 元数据，不抛错）。
  实测注意：transferStatus=2（数据库已下载态）时原生调用为 no-op——磁盘
  缺失场景无法经此恢复（详见 kernel design.md §5）。

## 4. satori 媒体（helper/element/media-convert.ts）

- video 非 mp4 输入 → `@napuketto/media transcodeVideo`（ffmpeg H.264 归一化，
  exitCode/产物校验）→ 失败/缺 ffmpeg fail-soft 原样透传。mp4 直通不转码。
- audio 已有 ensureSilk（非 silk 转码）不变。

## 5. media 包依赖面（ADR-011）

adapter 依赖 `@napuketto/media`（encodePcmToSilk / decodeSilkToWav /
transcodeVideo / downloadUrl / inferExtension）。kernel 不依赖 media。

## 6. 已知缺口（2026-09-10 c3 轮后）

- poke 翻译字段校准（首次真实事件后；手动触发指引见 §1）。
- **onRecvSysMsg protobuf 解码**（group_card / group_title / group_sign 的
  翻译前置；raw 字节日志已在 loader.log 积累）。
- onRecvOfflineFileMsg payload 形状校准（翻译已上线，收窄口径待真实事件修正）。
- onGroupEssenceListChange payload 形状（group_essence 翻译待校准）。
- onBuddyReqChange payload 形状（BuddyReq 字段 words 等待真实事件校准）。
- msg_emoji_like 无推送源（疑经 onMsgInfoListUpdate 或轮询，待观测）。
