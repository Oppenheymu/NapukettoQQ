---
"koishi-plugin-adapter-napuketto": patch
---

fix(adapter): 修复控制台扫码登录二维码不显示——登录自动启动早于控制台客户端连接，二维码推送因 `broadcast` 无客户端被丢弃；修复服务值注册到 `ctx.root` 确保 `Client.refresh()` 的 PULL 能拉到快照，并在 `console/connection` 事件触发时兜底推送
