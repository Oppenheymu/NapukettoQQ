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

## 5. 已知缺口（下一轮）

- Buddy listener 回调 payload 形状（onBuddyReqChange/onBuddyListChange）——
  adapter 侧 raw 日志积累中，真实事件到达后回填 narrow 函数。
- downloadRichMedia 原生签名（语音主动下载）。
- poke 的 aioOpGrayTipElement 完整字段（adapter 侧翻译待校准）。
