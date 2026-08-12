---
"@napuketto/loader": patch
---

feat(loader): Linux/wine 平台分支（P2 纯逻辑层）——toWinePath 路径映射 + win-node 下载

- `wine.ts`：`toWinePath()` Linux 路径 → wine `Z:\` 路径（幂等，含盘符保护）+ `buildSpawnCommand()` 平台分支（win32 本机 node / linux wine）
- `win-node.ts`：`ensureWinNode()` 下载 Windows 版 node.exe（nodejs.org 官方 zip → 7z 解压 → 缓存，幂等；NAPUTO_WIN_NODE_PATH/NAPUTO_WIN_NODE_VERSION 可覆盖）
- `launcher.ts`：`launchSelfHost` 变 async，linux 场景自动走 wine + win-node，传给子进程的所有路径过 toWinePath；win32 行为不变
- cli `boot.ts` 适配 async 调用
- 新增 `wine.test.ts`（9 单测：toWinePath 5 + buildSpawnCommand 3 + wineBinary 1）
