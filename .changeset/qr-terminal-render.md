---
"@napuketto/loader": patch
"@napuketto/cli": patch
---

feat(cli): 终端渲染登录二维码——loader 在自建宿主（非 IPC）模式经 `NAPUTO_QR` 标记行向 stdout 透出二维码数据，cli `forwardFiltered` 解析后用 qrcode 包渲染终端二维码（png 落盘与 URL 提示保留）；顺带移除未使用的 picocolors 依赖
