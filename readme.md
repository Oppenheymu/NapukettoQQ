# NapukettoQQ

基于 **QQ NT 架构客户端**的机器人框架：通过 `process.dlopen` 加载 QQ 原生模块 `wrapper.node`，对外提供 **OneBot 11**（当前）、**OneBot 12 / Satori**（规划）等多协议接口。

- **许可证**：MIT（零引入 NapCat 代码，全自研）
- **技术栈**：pnpm monorepo · TypeScript · tsdown · biome
- **状态**：OneBot 11 已实现（78 个动作），OneBot 12 / Satori 规划中

> **注意**：`@napuketto/loader` 的 V2 载具（Native Bypass DLL）为**闭源组件**——
> 逆向腾讯 QQ 的产物（RVA/Offset 表）不进公共仓库，载具源码不随本仓库分发，
> 仅分发编译+混淆后的二进制。公共仓库只含注入框架。

## 文档

| 文档 | 内容 |
|---|---|
| [`AGENTS.md`](AGENTS.md) | 工程指南（约束 / 命令 / 风格 / 实现模式） |
| [`docs/architecture.md`](docs/architecture.md) | 总体架构设计 + 决策记录（ADR） |
| [`docs/architecture-v2-native-bypass.md`](docs/architecture-v2-native-bypass.md) | V2 架构决策书（Native Bypass 混合模式） |
| [`packages/kernel/docs/design.md`](packages/kernel/docs/design.md) | kernel：唯一原生交互层 |
| [`packages/network/docs/design.md`](packages/network/docs/design.md) | network：协议无关传输层 |
| [`packages/adapter/docs/design.md`](packages/adapter/docs/design.md) | adapter：协议适配器容器（core 框架 + onebot11/onebot12/satori） |
| [`packages/media/docs/design.md`](packages/media/docs/design.md) | media：媒体转码 |
| [`packages/loader/docs/design.md`](packages/loader/docs/design.md) | loader：引导组件（注入 + V2 载具闭源边界） |
| [`apps/cli/docs/design.md`](apps/cli/docs/design.md) | cli：启动编排 |

## 快速开始

```bash
pnpm install
pnpm check
pnpm build
pnpm start   # 拉起 QQ + 注入引导 + OneBot 11 服务
```
