---
"@napuketto/loader": patch
---

fix(loader): cli（非 IPC）模式 loader logger 同步落盘 logs/loader.log——此前仅 IPC 模式落盘，cli 模式 poke/Buddy 校准等诊断数据全部丢失；console 输出保持不变，IPC 模式关 console 行为（stdout JSON 行协议保护）不变
