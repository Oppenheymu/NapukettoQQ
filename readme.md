# NapukettoQQ

基于 QQ NT 原生模块 `wrapper.node` 的机器人框架，对外提供 **OneBot 11** 协议接口（Satori 规划中，OneBot 12 已放弃）。

- **MIT** · 全自研 · 零引入 NapCat 代码
- pnpm monorepo · TypeScript · tsdown · biome
- **自建宿主**：标准 node + stub QQNT.dll 直接加载 `wrapper.node`，不拉起 QQ、不注入

## 包结构

| 包 | 职责 |
|---|---|
| `@napuketto/kernel` | 唯一原生交互层：wrapper 引导、登录（快速/扫码）、session 激活、业务 API、事件通道、缓存 |
| `@napuketto/adapter` | 协议适配器：core 框架 + onebot11（60+ 动作，HTTP/WS 多实例） |
| `@napuketto/network` | 协议无关传输层（HTTP / WebSocket / 广播） |
| `@napuketto/media` | 媒体转码（silk / ffmpeg） |
| `@napuketto/loader` | 自建宿主引导（spawn 标准 node + stub QQNT.dll 转发宿主符号） |
| `@napuketto/cli` | 启动编排、多账号 supervisor、配置管理 |

## 快速开始

```bash
pnpm install
pnpm check
pnpm build
pnpm start                    # 启动 → 自动登录（快速/扫码）→ OneBot 11 服务
pnpm start -- -q <QQ号>       # 快速登录指定账号
pnpm start -- config init     # 生成配置文件
```

配置为项目根单一 TOML：`napuketto.toml`（`config init` 或首次启动自动生成，示例见 `napuketto.toml.example`）。数据（账号/日志/缓存）按数据根组织：`--data-dir` > `NAPKETTO_DATA` > `~/.napuketto`。

> **闭源子模块**：自建宿主需要 stub QQNT.dll（`packages/loader/native`，private 仓库）。clone 后执行 `git submodule update --init --recursive`，或启动时用 `--stub-dir` 指定。

## 文档

- `docs/STATUS.md` — 现状与关键决策点
- `docs/architecture.md` — 架构书
- `AGENTS.md` — 工程指南
