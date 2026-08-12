---
"@napuketto/loader": patch
---

feat(loader): QQ 原生文件多级来源定位（P0 跨平台前置）

新增 `resolveQqFiles()`：L0 `NAPUTO_QQ_FILES` 显式文件根 → L1 本机 QQ 安装（既有逻辑保留）→ L2 数据根缓存 `<数据根>/qq-files/<版本>/` 依次探测，为「本机无 QQ / Linux / Docker」场景铺路；`QqInstallInfo` 新增 `source: "local" | "cached"` 字段。`resolveQqInstall` 旧签名保留兼容。
