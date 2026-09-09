---
"@napuketto/loader": patch
"@napuketto/cli": patch
---

fix(loader,cli): instance-lock pid 复用根治——pid 探活通过后新增 cmdline 二次校验（新模块 pid-cmdline：Windows 走 PowerShell Get-CimInstance 跨进程查询、Linux 走 /proc，查不到或与锁内摘要不一致视为持有者已死自动接管，根治 2026-09-08「pid 被无关进程复用导致永久拒绝启动」事故）；写锁时自动填本进程命令行摘要（调用方无需显式传）；cli 启动预检走同一判定自动生效，误报提示文案更新
