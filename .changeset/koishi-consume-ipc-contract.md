---
"koishi-plugin-adapter-napuketto": patch
---

refactor(adapter): IPC 协议消费 @napuketto/loader 的 zod 单一来源契约——删除本地 src/ipc/types.ts 手工镜像，codec 解码改用 IpcMessageSchema.safeParse（顺带校验 payload 形状）。
