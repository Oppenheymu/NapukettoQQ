---
"@napuketto/kernel": patch
"@napuketto/loader": patch
---

fix(kernel): 修复 sendMsg 失败导致子进程崩溃（unhandledRejection）

`MsgApi.sendMessage` 中若 `service.sendMsg` 抛错（wrapper 内部异常），已注册的
`confirmSend` 确认 Promise 无人消费，随后 `onMsgInfoListUpdate` 确认事件
（sendStatus=0）触发 `reject` 时变成 unhandledRejection，Node 默认抛错退出，
直接拖垮整个子进程并连带 IPC 通道关闭。现预消费 confirm 的 rejection 兜底，
失败语义不变。loader self-host 同步加 unhandledRejection 日志兜底（不退出），
防止同类漏网 rejection 再拖垮进程。
