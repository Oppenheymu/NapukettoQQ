# NapukettoQQ

<p align="center">
  <b>基于 QQ NT 原生模块的高性能机器人框架</b>
  <br/>
  直接加载 <code>wrapper.node</code>，自建宿主运行，对外提供 OneBot 11 协议接口
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white">
  <img alt="PNPM" src="https://img.shields.io/badge/PNPM-11-F69220?logo=pnpm&logoColor=white">
  <img alt="OneBot" src="https://img.shields.io/badge/OneBot-11-0084ff">
  <img alt="Monorepo" src="https://img.shields.io/badge/Monorepo-pnpm%20workspace-00B4A0">
</p>

## 核心特性

- **原生 API 直接交互** — 直接调用 `wrapper.node` 官方 NAPI 导出接口（`getMsgService` 等），不经过代理层，稳定高效
- **高性能自建宿主** — 标准 Node 进程 + stub QQNT.dll 符号转发，直接加载原生模块，内存占用目标百兆级，远低于注入方案
- **无侵入运行** — 不拉起 QQ 客户端、不注入任何进程、零磁盘篡改；仅运行期内存加载，升级/卸载零残留
- **OneBot 11 深度兼容** — 60+ 动作覆盖消息/群/好友/系统管理，HTTP / WebSocket / 反向 WebSocket 多实例
- **多账号 Supervisor** — 单进程编排多账号，崩溃自动重启
- **单一 TOML 配置** — 项目根 `napuketto.toml`，配置与数据目录解耦
- **全自研 · MIT** — 零引入 NapCat 代码，许可证纯净



## 架构与包结构（Monorepo）

```
┌────────────────────────────────────────────────────────────┐
│  应用 / CLI 层                                                │
│   cli ───────────── 启动编排 · 多账号 supervisor · 配置管理    │
│   create-napukettoqq ─ 一键部署（生成项目骨架 + 安装依赖）      │
└───────────────────────────┬────────────────────────────────┘
                            │ 依赖
┌───────────────────────────▼────────────────────────────────┐
│  协议 / 传输层                                                │
│   adapter ────── OneBot 11 协议适配（core 框架 + 60+ 动作）   │
│   network ────── 协议无关传输（HTTP / WebSocket / 广播）      │
│   media ──────── 媒体转码（silk / ffmpeg）                    │
└───────────────────────────┬────────────────────────────────┘
                            │ 依赖
┌───────────────────────────▼────────────────────────────────┐
│  核心 / 宿主层                                                │
│   kernel ─────── 唯一原生交互层（wrapper · 登录 · API · 缓存）│
│   loader ─────── 自建宿主引导（stub QQNT.dll 转发宿主符号）    │
└────────────────────────────────────────────────────────────┘
```

> **依赖方向严格单向向下**：上层可依赖下层，下层不得反向依赖上层（kernel 无内部依赖，仅 pino + smol-toml）。

### 应用与 CLI

| 包 | 职责 |
|---|---|
| [@napuketto/cli](./apps/cli) | 启动编排、多账号 supervisor、配置管理 |
| [create-napukettoqq](./apps/create-napukettoqq) | 一键部署：生成项目骨架并自动安装依赖 |

### 协议与传输

| 包 | 职责 |
|---|---|
| [@napuketto/adapter](./packages/adapter) | 协议适配器：core 框架 + onebot11（60+ 动作） |
| [@napuketto/network](./packages/network) | 协议无关传输层（HTTP / WebSocket / 广播） |
| [@napuketto/media](./packages/media) | 媒体转码（silk / ffmpeg） |

### 核心与宿主

| 包 | 职责 |
|---|---|
| [@napuketto/kernel](./packages/kernel) | 唯一原生交互层：wrapper 引导、登录、session 激活、业务 API、事件通道、缓存 |
| [@napuketto/loader](./packages/loader) | 自建宿主引导（stub QQNT.dll 转发宿主符号） |

## 快速开始

### 1. 一键部署

```bash
pnpm create napukettoqq
```

按提示输入部署目录名（回车取默认 `NapukettoQQ`），自动生成项目骨架并安装依赖。

### 2. 启动登录

```bash
pnpm start
```

自动登录（有历史登录记录走快速登录，否则二维码扫码），就绪后 OneBot 11 服务开始监听。

### 3. 配置

配置为项目根单一 TOML：`napuketto.toml`（首次启动自动生成，示例见 `napuketto.toml.example`）：

```toml
# 数据根目录：账号/日志/缓存/QQ 数据存放位置
dataDir = "C:\\Users\\<用户名>\\.napuketto"
```
数据根解析优先级：`--data-dir <dir>` > 环境变量 `NAPKETTO_DATA` > `~/.napuketto`。

## 版本与发布

版本管理用 **Changesets**（多包 monorepo 自动联动版本号与依赖）：

```bash
pnpm changeset              # 开发完一批改动后，记录版本 bump（major/minor/patch + 说明）
pnpm release                # 消费 changeset：自动升版本 + 写 CHANGELOG + 构建 + 按拓扑序发布
pnpm release:dryrun         # 同上但只演练（dry-run，不发包）
```

- 版本语义：`0.x.y` 阶段（API 未冻结）；`0.1.x → 0.2.x` = 不兼容改动，`0.0.x` = 修补；API 稳定后升 `1.0.0`
- `pnpm release` 会自动把有依赖关系的包一起升版本（如 kernel 升 patch，adapter 同步升 patch 并重新依赖新 kernel）
- 各包 `CHANGELOG.md` 由 changesets 自动生成；发布前确认 `.changeset/*.md` 已提交

##  许可证

[MIT](LICENSE)
