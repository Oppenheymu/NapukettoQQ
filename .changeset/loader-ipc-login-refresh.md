---
"@napuketto/loader": patch
---

feat(loader): IPC 服务端登录前提前启动 + login.refreshQr 动作

- 登录前即启动 stdin 服务端（动作表先只含 `login.refreshQr`）——原实现在登录成功
  + 协议装配后才启动，登录中（waiting_scan）前端刷新/control 指令堆积在 pipe
  缓冲区不可达；心跳 ping（15s）同步提前，防扫码耗时超过 45s 被 driver 误判失联强杀
- 登录后 `attachIpcServices` 把 kernel 服务动作并入同一张共享动作表 + 事件转发
  （`startIpcMode` 拆分为 `createIpcActionsForCore` + `attachIpcServices`）
- `IpcLoginPayload` / `sendLogin` 新增可选 `message`（失败原因透出）
