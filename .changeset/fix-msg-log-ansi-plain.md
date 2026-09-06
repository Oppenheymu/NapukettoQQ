---
"@napuketto/loader": patch
---

修复 IPC 模式文件日志 ANSI 污染：消息日志 logger 落 plain（IPC 为纯文件 JSON 日志），cli 终端保持彩色；顺带简化 createLoginControlHandler 内仅 IPC 注册路径可达的 ipcMode 死分支
