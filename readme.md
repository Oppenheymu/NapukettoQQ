# NapukettoQQ

基于 **QQ NT 架构客户端**的机器人框架：通过 `process.dlopen` 加载 QQ 原生模块 `wrapper.node`，对外提供 **OneBot 11**（当前）、**OneBot 12 / Satori**（规划）等多协议接口。

- **许可证**：GPL-3.0（零引入 NapCat 代码，全自研）
- **技术栈**：pnpm monorepo · TypeScript · tsdown · biome
- **状态**：设计阶段（P0 未开工）

## 文档

| 文档 | 内容 |
|---|---|
| [`AGENTS.md`](AGENTS.md) | 工程指南（约束 / 命令 / 风格 / 实现模式） |
| [`docs/architecture.md`](docs/architecture.md) | 总体架构设计 + 决策记录（ADR） |
| [`packages/kernel/docs/design.md`](packages/kernel/docs/design.md) | kernel：唯一原生交互层 |
| [`packages/network/docs/design.md`](packages/network/docs/design.md) | network：协议无关传输层 |
| [`packages/adapter/docs/design.md`](packages/adapter/docs/design.md) | adapter：协议适配器容器（core 框架 + onebot11/onebot12/satori） |
| [`packages/media/docs/design.md`](packages/media/docs/design.md) | media：媒体转码 |
| [`apps/cli/docs/design.md`](apps/cli/docs/design.md) | cli：启动编排 |

## 快速开始

```bash
pnpm install
pnpm check
```
