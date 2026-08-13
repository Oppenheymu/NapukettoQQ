---
"koishi-plugin-adapter-napuketto": patch
---

feat(adapter): 扫码登录「刷新二维码」改为 IPC 直达（不再重启子进程）+ 超时文案

- 前端「刷新二维码」按钮改发 `refresh-qr` console 事件 → `requestRefreshQr()`
  → IPC `login.refreshQr` 动作直达 kernel，不重启子进程（「重新登录」按钮仍保留重启语义）
- `NapukettoLoginProvider` 新增 `refresh-qr` 事件上行；`NapukettoLoginState.onLogin`
  支持 `message`（failed 态失败原因，如「登录超时，请刷新页面重试」）
- 前端 waiting_scan 增加「请在两分钟内…」提示，移除 3 分钟 UI 过期计时器
  （kernel 已自动刷新 + 120s 超时兜底）
