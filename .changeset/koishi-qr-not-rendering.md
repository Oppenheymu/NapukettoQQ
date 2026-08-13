---
"koishi-plugin-adapter-napuketto": patch
---

fix(adapter): 修复控制台扫码登录二维码不显示——登录自动启动早于控制台客户端连接，二维码推送因 `broadcast` 无客户端被丢弃；改为服务值注册到 root store（`Client.refresh()` 的 PULL 能读到）并拿 `set` 返回的 dispose 函数在 bot dispose 时清理，reload 不再报 `service has been registered`
