# @napuketto/kernel 设计书（2026-09-08 首版：覆盖 bridge/event-channel/apis 模块）

> 本包是唯一原生交互层（AGENTS.md 红线 3）：只有 kernel 允许 `process.dlopen`、
> 访问 `wrapper.node`、注册原生 listener。其他包只调语义化 API / 订阅事件通道 /
> 读缓存。无全局单例（ADR-015 推论）：logger/cache/event-channel 均实例化，
> 由 `CoreContext` 持有。本文覆盖 2026-09-08 接线轮次动到的模块；wrapper 加载 /
> login / paths / config 等既有模块详见源码头注释与 `docs/architecture.md`。

## 1. 事件桥（bridge/）

三座桥（Msg/Group/Friend），同构模式：

| 桥 | 原生服务 | listener 注册 | 通道类型 | 事件（`${Service}/${method}`） |
|---|---|---|---|---|
| MsgBridge | getMsgService | addKernelMsgListener | `NTEventChannel<MsgListener, "Msg">` | onRecvMsg / onRecvMsgReadReport / onRecvMsgReceipt / onMsgInfoListUpdate |
| GroupBridge | getGroupService | addKernelGroupListener | `NTEventChannel<GroupListener, "Group">` | onGroupListInited / onGroupListUpdate / onGroupDetailInfoChange / onMemberListChange / onMemberInfoChange / onGroupNotifiesUpdated / onGroupSingleScreenNotifies / onShutUpMemberListChanged |
| FriendBridge（2026-09-08 新增） | getBuddyService | addKernelBuddyListener | `NTEventChannel<BuddyListener, "Buddy">` | onBuddyReqChange / onBuddyListChange / onBuddyListChangedV2 / onBuddyDeleted |

- 桥只做透传：原生回调参数原样 emit 进通道（payload 不改写）。
- register/unregister 幂等（listenerId 判空）。
- **FriendBridge 方法名证据**：wrapper.node（9.9.33-52230）二进制字符串提取
  （`grep -aoE "onBuddy[A-Za-z0-9]+" wrapper.node | sort -u`），与 Group/Msg
  listener 已知名交叉验证可靠。**回调参数形状未经真实事件校准**（listener
  类型参数一律 unknown，订阅方防御性收窄 + raw 日志积累校准数据）。

### 装配（loader 侧 kernel-services.ts）

登录成功后 `createKernelServices`：每座桥 `new NTEventChannel(<Service>)` +
`new XxxBridge(session, channel)` + `register()`。进程级存活（无 dispose 路径，
与进程生命周期一致）。IPC 模式下三条通道均经 `forwardChannel`（onAny）转发为
IPC event 消息（koishi 插件消费）；协议模式由 adapter 订阅。

## 2. 事件通道（event-channel.ts）

`NTEventChannel<L, Name>`：EventEmitter 封装，事件名从 Listener 接口方法名
编译期推导（ADR-003）。`on(event, handler)` 返回退订函数；`onAny` 全事件订阅
（IPC 转发用）；`waitFor` 带过滤/超时；订阅者异常不打断派发（onError 上报）。

## 3. apis/（12 个，统一错误语义 ADR-009）

成功返业务值 / 失败抛 `KernelError`（类型化错误码，协议层映射表消费）。
本次接线相关：

- **friend.ts**：`getBuddyReqList()`（getBuddyReq → buddyReqs）；
  `handleFriendRequest(notify, accept)`（approvalFriendRequest）。
  OB11 `set_friend_add_request` 的 flag = `BuddyReq.reqTime`（拉取匹配）。
- **group-notify.ts**：`getSingleScreenNotifies(doubt, count)` /
  `handleGroupRequest`。OB11 `set_group_add_request` 的 flag = `GroupNotify.seq`。
- **msg.ts**：`fetchMsgsByMsgId(peer, ids)`（get_image/get_record 反查）、
  `placeMediaFile`（发送侧 NapCat 式放置：getRichMediaFilePathForGuild +
  util.copyFile）。
- **richmedia.ts**：群文件系列（getGroupFileList 等）。**注意**：原生
  `downloadRichMedia` 方法存在于 wrapper（字符串证据），但签名未探测——
  收方向语音/图片主动下载的原生路径待实测后接入（当前 adapter 侧用
  picUrl + HTTP 下载兜底，见 adapter design.md）。

## 4. 类型层来源（ADR-006）

`types/listeners/`（msg/group/buddy）+ `types/services/`（运行时反射面）+
`types/entities.ts`（RawMessage/GrayTip/Pic/Ptt 等）。类型来自运行时探测 +
wrapper 二进制字符串证据；未实证的字段标「待探测校准」注释。探测脚本在
`src/wrapper/probe/`（probe.ts 入口）。

## 5. downloadRichMedia 探测产物（2026-09-08 B1 实测，QQ 9.9.33-52230）

探测方式：`scripts/probe-download-richmedia.mjs`（IPC 宿主 + diag.msgServiceCall /
diag.richMediaCall；产物全文 `$TEMP/napuketto-probe/artifacts.json`）。

### 5.1 方法面（运行时 `__methods` 枚举）

- **NodeIKernelMsgService** 有 `downloadRichMedia` / `getRichMediaElement` /
  `getLatestDbMsgs` / `getMsgsByMsgId`（`getMsgs` 需 4 参：peer, msgId, count, false——
  fetchMessages 现有路径）。
- **NodeIKernelRichMediaService** **无** 裸 `downloadRichMedia`，只有
  `downloadRichMediaInVisit` + downloadFile 族（downloadFileForFileUuid /
  downloadFileByUrl / downloadFileForFileInfo / downloadFile / onlyDownloadFile 等）。

### 5.2 downloadRichMedia 签名（实测）

```ts
// NodeIKernelMsgService（单参数对象；二进制 assertion "needs 1 arguments"）
downloadRichMedia(param: {
    msgId: string;       // 消息 ID（msgId 字符串）
    elemId: string;      // 元素 ID（elementId 字符串）
    chatType: number;    // 2=群 1=C2C
    downloadType: number;// 2 实测可用
    thumbSize: number;   // 0
}): Promise<void>        // ⚠️ resolve undefined——下载结果不从返回值拿
```

- 返回 void：下载完成信号只能经**重拉消息元素**（transferStatus/filePath）或事件观察。
- 参数残缺（msgId/elemId undefined）时**不抛错**（内部静默 no-op）——调用方必须自证参数完整。
- `richMediaService.downloadRichMediaInVisit` 同款参数抛
  `Cannot convert undefined or null to object`（需额外未知字段，未深挖——MsgService 版已够用）。

### 5.3 行为实测（挪文件实验）

- `pttElement.filePath` 收向为**绝对路径**（`…\nt_qq\nt_data\Ptt\2026-08\Ori\<md5>.ogg`），
  本地命中时 `existsSync(filePath)` 直接可用。
- `transferStatus` 实测样本：**4 = 自己发送（已上传）**、**2 = 收到（数据库标记已下载）**。
- **transferStatus=2 时调 downloadRichMedia 不重新落盘**（把本地文件挪走后调用，
  12s 轮询文件不回来、transferStatus 恒 2）——wrapper 以数据库状态为准，不查磁盘。
  结论：downloadRichMedia 的有效场景 = transferStatus ≠ 2 的未下载消息（如清理过
  缓存后重收/其他端的消息）；已下载但磁盘缺失的场景无法用此方法恢复。
- kernel 实现策略（apis/msg.ts `downloadPtt`）：调用后**轮询 getMsgsByMsgId**
  （300ms 间隔，总超时 10s）直到 pttElement.filePath 存在且磁盘命中，超时回退
  （由 adapter 层回退原始路径 + 元数据）。

### 5.4 PttElement 完整字段（实测快照，2026-09-08）

收向全字段（历史消息 getLatestDbMsgs 提取，比既有类型多出斜体字段）：
fileName / filePath / md5HexStr / fileSize / duration / formatType / voiceType /
autoConvertText / voiceChangeType / canConvert2Text / fileId / fileUuid / text /
translateStatus / *transferStatus* / *progress* / *playState* / waveAmplitudes /
*invalidState* / fileSubId / *fileBizId* / *import_rich_media_context* / storeID /
otherBusinessInfo{aiVoiceInfo, aiVoiceType} / *isInApplicationDataPath*。
（斜体 = 本轮补进 types/entities.ts 的字段。）

## 6. 已知缺口（下一轮）

- Buddy listener 回调 payload 形状（onBuddyReqChange/onBuddyListChange）——
  onBuddyListChange 已实测 = BuddyCategory[] 全量快照（T10，buddyList 明细含
  uid/uin/coreInfo/baseInfo/status/vasInfo）；onBuddyReqChange 仍待校准。
- poke 的 aioOpGrayTipElement 完整字段（adapter 侧翻译待校准）。
- downloadRichMedia 对 transferStatus≠2 消息的真实下载行为（本机所有样本已下载，
  无法自然构造未下载样本——签名已实证，行为按轮询策略防御）。
