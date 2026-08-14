---
"koishi-plugin-adapter-napuketto": patch
---

修复 WSL/Linux 生产环境子进程启动失败：透传子进程 stderr（此前 code=1 退出时错误被 pipe 吞掉无从诊断），并将 QQ 原生文件定位改为按平台分支——linux 直接用数据根 ext4 缓存并缺失自动下载，避免命中 /mnt/c DrvFS 导致 wine 读不到 wrapper.node。
