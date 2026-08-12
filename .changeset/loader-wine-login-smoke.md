---
"@napuketto/loader": patch
---

feat(loader): Linux/wine 完整链路登录冒烟脚本（P2 Step 2）

- `scripts/wine-login-smoke.mjs`：WSL2 一键完整链路冒烟——确保 QQ 文件 → 确保 Windows 版 node.exe → wine 跑 win-node 执行 self-host.cjs（dlopen wrapper.node → O3MiscService 激活 → 登录 → session READY → 协议装配），`--uin` 指定快速登录账号，90s 观察窗口
- 环境变量装配与 launcher.buildLaunchEnv 同构，路径全部过 toWinePath（Z:\ 视角）
