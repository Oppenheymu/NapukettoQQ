---
"@napuketto/loader": patch
---

feat(loader): IPC 协议契约改为 zod 单一来源——loader 导出 IpcMessageSchema 与全部协议类型（替代 koishi 侧 src/ipc/types.ts 手工镜像，消除两侧类型漂移），新增 zod 依赖；ipc-codec 解码改用 IpcMessageSchema.safeParse（顺带校验 payload 形状，非法 payload 在边界即拦截）。koishi 适配器同步改为消费该契约。
