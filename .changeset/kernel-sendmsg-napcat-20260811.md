---
"@napuketto/kernel": patch
"@napuketto/loader": patch
---

fix(kernel): 修复消息发送失败（sendMsg 返回 result=5 被误判失败）

问题根因：旧实现以 `sendMsg(msgId, peer, ...)` 调用并直接看返回值 `result===0` 判成败，
但 wrapper 对正确调用返回 `result=5`（文本/图片均失败）。按 NapCat 同款方式修复：

- sendMsg 第一参固定传 `'0'`，msgId 塞 `peer.guildId`
- 先注册 `onMsgInfoListUpdate` 事件监听再调 sendMsg，以事件 `sendStatus===2` 确认发送成功
  （sendMsg 返回值 result 非 0 不立即判失败——富媒体异步上传时 result=5 常见）
- `MsgBridge` 补注册 `onMsgInfoListUpdate` 回调（此前缺失，发送状态事件不透传）
- `MsgApi` 构造支持注入消息事件通道；无通道时退化为旧行为

实测：文本消息成功发送到群（boot 日志确认）；图片发送错误从模糊的
`rich media transfer failed` 变为清晰的 `sendStatus=0`（图片仍失败，根因另查）。
