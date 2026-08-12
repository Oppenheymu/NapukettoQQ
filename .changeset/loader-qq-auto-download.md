---
"@napuketto/loader": patch
---

feat(loader): QQ 官方安装包自动下载解包缓存（P1，本机无 QQ 场景可用）

- `qq-releases.json` 版本清单（含 9.9.33-51802 实测 sha256）
- `qq-download.ts`：https 下载 + sha256 校验（零第三方依赖，NAPUTO_QQ_URL 可覆盖）
- `qq-extract.ts`：完整版 7z 解 NSIS 安装包 + 提取 resources/app 顶层 `*.node`/`*.dll`（内置 assets/7zip，LGPL 合规；真实 QQNT.dll 由 stub 替代无需提取）
- `ensureQqFiles()`：下载→校验→解包→提取→缓存，幂等（缓存命中直接返回）
- `resolveQqFiles()` 改 async，L0/L1/L2 全部缺失时自动进入下载流程
