---
"@napuketto/kernel": patch
---

feat(kernel): QR 登录暴露手动刷新句柄 + 120s 登录超时（复刻 bilibili-dm 扫码交互）

- `NapukettoCore` 新增 `refreshQr(): boolean`——登录期间持有 `qrSession` 句柄，
  供 koishi 前端「刷新二维码」按钮经 IPC 直达，不再重启子进程
- `QrLoginSession` 新增 120s 登录超时（照搬参考项目 60×2s）：出码后计时，
  超时未登录 → `failed` + `failureReason`「登录超时，请刷新页面重试」；
  每次 `refresh()` 重置计时，登录成功/失败/stop 清理
- `LoginProgress` 新增可选 `message`（failed 态失败原因，经 IPC 透出）
