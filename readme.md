# NapukettoQQ

基于 **QQ NT 客户端原生模块**（`wrapper.node`）的机器人框架，对外提供 **OneBot 11**（当前）与 **Satori**（规划）协议接口（OneBot 12 已放弃）。

- **许可证**：MIT（零引入 NapCat 代码，全自研）
- **技术栈**：pnpm monorepo · TypeScript · tsdown · biome
- **状态**：**自建宿主全链路跑通**——标准 node + stub QQNT.dll 转发：登录（快速/扫码）→ session READY → 收发 → OneBot 11 服务（78 个动作）
- **功能范围**：NapCat 全部能力 − WebUI − 插件系统

> **闭源组件**：`@napuketto/loader` 的 V2 载具（Native Bypass DLL，`native/` 子模块）为私有组件——逆向腾讯 QQ 的产物不进公共仓库，公共仓库仅含注入框架。clone 后执行 `git submodule update --init --recursive`。

## 文档

| 文档 | 内容 |
|---|---|
| [`AGENTS.md`](AGENTS.md) | 工程指南（约束 / 命令 / 风格 / 实现模式） |
| [`docs/STATUS.md`](docs/STATUS.md) | **现状 + 关键决策点（新对话先读）** |
| [`docs/architecture.md`](docs/architecture.md) | 架构书（分层 / ADR / 路线图 / 红线） |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | 决策史（V1→V10 路线演进归档） |
| `packages/*/docs/design.md` | 各包设计（kernel / network / adapter / media / loader / cli） |

## 快速开始

```bash
pnpm install
pnpm check
pnpm build
pnpm start   # 自建宿主（标准 node + stub QQNT.dll 转发）→ 登录 → OneBot 11 服务
```

配置为全局单一 TOML：`<项目根>/napuketto.toml`（主配置段 + `[onebot11]` 协议段），数据（账号/日志/缓存）按数据根组织。
