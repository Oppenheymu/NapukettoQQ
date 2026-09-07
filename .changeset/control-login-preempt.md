---
"@napuketto/loader": patch
---

feat(loader): control login 登录期抢占——初始 doLogin 与 control login 竞速（快速登录风控挂起时强制扫码/重登的结果接管装配链）；新增 NAPUTO_QR_ONLY 强制扫码环境变量（launcher qrOnly 选项透传）；修正 ipc-types「预留」过时注释
