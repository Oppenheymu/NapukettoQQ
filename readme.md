# NapukettoQQ

基于 **QQ NT 架构客户端**的机器人框架：通过 QQ 原生模块 `wrapper.node` 对外提供 **OneBot 11**（当前）、**Satori**（规划）等多协议接口（OneBot 12 已放弃）。

- **许可证**：MIT（零引入 NapCat 代码，全自研）
- **技术栈**：pnpm monorepo · TypeScript · tsdown · biome
- **状态**：业务基本实现——自建宿主全链路跑通（标准 node + stub QQNT.dll：登录 → 收发 → OneBot 11 服务），Satori 规划中

> **注意**：`@napuketto/loader` 的 V2 载具（Native Bypass DLL）为**闭源组件**——
> 逆向腾讯 QQ 的产物（RVA/Offset 表）不进公共仓库，载具源码不随本仓库分发，
> 仅分发编译+混淆后的二进制。公共仓库只含注入框架。

## 文档

| 文档 | 内容 |
|---|---|
| [`AGENTS.md`](AGENTS.md) | 工程指南（约束 / 命令 / 风格 / 实现模式） |
| [`docs/STATUS.md`](docs/STATUS.md) | **现状 + 关键决策点（新对话先读）** |
| [`docs/architecture.md`](docs/architecture.md) | 架构书（分层 / ADR / 路线图 / 红线 / 工具链） |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | 决策史（V1→V10 路线演进归档） |
| [`packages/kernel/docs/design.md`](packages/kernel/docs/design.md) | kernel：唯一原生交互层 |
| [`packages/network/docs/design.md`](packages/network/docs/design.md) | network：协议无关传输层 |
| [`packages/adapter/docs/design.md`](packages/adapter/docs/design.md) | adapter：协议适配器容器（core 框架 + onebot11/satori） |
| [`packages/media/docs/design.md`](packages/media/docs/design.md) | media：媒体转码 |
| [`packages/loader/docs/design.md`](packages/loader/docs/design.md) | loader：引导组件（注入 + V2 载具闭源边界） |
| [`apps/cli/docs/design.md`](apps/cli/docs/design.md) | cli：启动编排 |

## 快速开始

```bash
pnpm install
pnpm check
pnpm build
pnpm start   # 自建宿主（标准 node + stub QQNT.dll 转发）→ 登录 → OneBot 11 服务
```
