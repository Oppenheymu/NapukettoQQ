---
"@napuketto/loader": patch
"koishi-plugin-adapter-napuketto": patch
---

fix: IPC 模式「能收不能发」根治——子进程 stdout 承载 JSON 行协议，却被两处 pino console 流（kernel NapukettoCore.create 与 loader kernel-services 的 createLogger）并发写入，协议行撕裂后 koishi 侧解码失败静默丢弃，恰逢 bootstrap 尾部日志密集窗口丢失 status ready，事件照常派发但发送全抛「子进程未就绪（等待驱动连接）」。四层修复：① IPC 模式（NAPUTO_IPC=1）两处 logger 关 console、改文件落盘（kernel logs/napuketto.log 原有，loader 新增 logs/loader.log），cli 输出不变；② 新增 control status 查询指令——子进程快照最近 status 并重播，防原生 printf 直写 fd 等 JS 层拦不住的残留污染；③ driver 自愈：收到 event 但状态未 ready（5s 节流）或 booting 超时（20s 定期）主动查询，ready 分支加幂等守卫防重复 onReady；④ IPC 脏行不再静默丢弃——双侧（koishi client onJunkLine debug 日志 + 子进程 boot 日志）留痕。
