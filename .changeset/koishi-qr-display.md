---
"koishi-plugin-adapter-napuketto": patch
---

fix(adapter): 修复控制台扫码登录二维码不显示——二维码改为后端拼成完整 data URI（`image` 字段）由前端 `<img :src>` 直接展示（参照 bilibili-dm 的 image 模式，不再前端拼 `data:image/png;base64,`）；并在 console 服务自身作用域监听 `console/connection`，客户端连接瞬间兜底重推最新登录快照（登录自动启动早于客户端连接，PUSH 被 broadcast 的 `!handles.length` 丢弃）
