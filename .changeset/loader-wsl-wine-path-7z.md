---
"@napuketto/loader": patch
---

修复 WSL/Linux 生产环境两个问题：① wine 场景 PATH 混入 Unix 路径（冒号分隔）导致 stub QQNT.dll 目录被拆散、wrapper.node 依赖的 QQNT.dll 找不到——PATH 逐条转 Z:\\ 纯 Windows 风格；② Linux 缺少 7z（内置资产是 Windows PE，系统未装 p7zip-full）导致 QQ 安装包解包失败——自动下载 7-Zip 官方 Linux 版 7zz 到数据根 runtime/7zip。
