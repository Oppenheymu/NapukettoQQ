---
"@napuketto/kernel": patch
"@napuketto/loader": patch
---

koishi 适配器 IPC 子进程模式前置（§7 loader 去脚本化，2026-08-08）：

- **kernel**：`NTEventChannel` 新增 `onAny`（全事件订阅，IPC 整通道转发用）；
  `CoreLoginOptions` 新增 `onLoginProgress` 回调（QR 阶段二维码/状态机转发）；
  `LoginProgress` 类型导出
- **loader**：新增 `src/host/ipc/`（NAPUTO_IPC=1 开启）——协议类型/编解码/发送封装/
  动作表（msg/group/friend 核心动作，peerUin 自动转 uid）/stdin 服务端（action/control/
  心跳）；`self-host.ts` IPC 分支发 status（booting→dlopening→logging→sessioning→ready/
  failed）；`protocols.ts` 重构拆出 `kernel-services.ts`（服务创建，IPC/协议共用）+
  `assemble-protocols.ts`（OB11/Satori 装配，非 IPC 零回归）；`launcher.ts` 新增
  `LaunchOptions.ipc`（注入 NAPUTO_IPC=1）

非 IPC 路径（cli pnpm start）行为零变化；`pnpm check` / 198 测试全绿。
