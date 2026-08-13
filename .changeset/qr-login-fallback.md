---
"@napuketto/kernel": patch
---

修复：QR 登录快速登录回退逻辑——`quickLoginWithUin` 失败时是 **resolve 带 `loginErrorInfo.errMsg`**（wrapper 契约，非 reject），原实现只挂 `.catch` 导致无登录凭据环境（如 WSL 扫码登录）下回退永不触发：二维码永不产生、完全静默阻塞（无日志无事件）。现改为检查 resolve 结果的 `errMsg` 再回退 `getQRCodePicture()`；同时 `loginByQr` 不再透传 `quickUin`（QR 回退路径下快速登录已失败过一次，二次快速登录在无凭据环境白等一个周期）。
