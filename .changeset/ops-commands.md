---
"@napuketto/cli": patch
---

feat(cli): 按账号运维命令——napuketto status/stop/restart [-q <uin>]（PID 状态文件 + 存活检测 + win32 树杀 taskkill /T /F + detached 重启）；supervisor 子进程 stdio 管道化逐行账号前缀转发，账号/ supervisor 运行时状态（pid/启动时间/守护重启计数）结构化落盘 runtime.json / supervisor.json
