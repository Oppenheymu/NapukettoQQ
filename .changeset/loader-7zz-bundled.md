---
"@napuketto/loader": patch
---

fix(loader): Linux 7zz 内置资产优先（治本）+ 版本 2409→2501（止血）

生产环境 7z 下载 404 根因：7-Zip 官网只保留最新版 tar.xz，硬编码 2409 已被删档
（实测 404，2501 为当前版）。治本：7zz 静态二进制（2.8MB，LGPL 合规）打进发布包
`assets/7zip/`（与 Windows 7z.exe 同模式，含 License-linux.txt），`ensureLinuxSevenZip`
优先级改为 内置资产 > 数据根缓存 > 官网下载兜底（NAPUTO_7Z_URL 可覆盖）——Linux
引导链不再依赖运行时外网下载 7z。`findSevenZip` 同步支持 Linux 内置资产。
QQ 安装包保持动态下载（qq-releases.json 清单 + NAPUTO_QQ_URL 覆盖，不变）。
