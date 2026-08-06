# NapukettoQQ 总体架构设计

> 状态：**P1 完成，P2 进行中**（消息链路 + NapCat API 78 动作 + 基础设施三项全落地） · 最后更新：2026-08-05
> 本文件是项目的架构总纲，配套文件：根 `AGENTS.md`（工程指南）、各包 `docs/design.md`（模块设计）。
>
> 进度坐标：kernel design.md §9 完成 8/9（login/cache 完成，剩 apis 的 user/file/system）；注入引导全链路实测打通（NAPI 范式，非 dlopen/koffi，见 AGENTS.md 技术路线第 7 条）；**一~六批 NapCat API 已实现（78 动作）+ 基础设施三项（P2-16 api 聚合 / P2-17 GroupCache / P6 cli config+supervisor）**；NapCat 功能对齐度 ≈ 70%。

---

## 1. 项目定位

NapukettoQQ 是一个基于 **QQ NT 架构客户端**的机器人框架：

- 通过 `process.dlopen` 动态加载 QQ 客户端自带的原生模块 `wrapper.node`，把 QQ 内部的 C++ 服务包装成语义化 API。
- 对外提供 **OneBot 11**（当前）、**Satori**（规划）等多协议接口（HTTP / WebSocket）。**OneBot 12 已放弃（2026-08-05 用户拍板：规范过于模糊，commit ac5ebba 删除占位）**。
- **永远不做 WebUI**（NapCat 的 WebUI 被判定为错误决策）；**全局配置走单一 TOML 文件**（`<数据根>/napuketto.toml`，主配置 + 各协议段，cli 读写 + zod 校验）。
- **不做 framework 模式**（QQNT 插件形式已被证明低效），只做 Shell 独立进程模式。

## 2. 包结构与依赖方向

```
apps/cli               启动编排（commander + qrcode 登录渲染 + 配置命令 + supervisor 多账号）
  └─ @napuketto/adapter   协议适配器容器（core 框架 + onebot11/satori）
       ├─ @napuketto/kernel   唯一原生交互层（wrapper / apis / 事件通道 / 缓存）
       ├─ @napuketto/network  协议无关传输层（HTTP / WS / 泛型广播）
       └─ @napuketto/media    媒体转码（silk / ffmpeg / 文件识别）
```

```mermaid
graph TB
    subgraph apps[apps/cli — 启动编排]
        CLI[参数解析 + 生命周期 + 登录渲染]
        CFG[config init/list/apply]
    end

    subgraph kernel[@napuketto/kernel — 听懂 QQ]
        TYPES[types: wrapper/services/listeners/entities]
        LOAD[wrapper-loader: dlopen + 版本探测]
        CH[event-channel: 类型化事件通道]
        API[apis: 语义化 NT API]
        CACHE[cache: 主动同步缓存]
        CORE[NapukettoCore]
        LOGIN[login: 状态机 + QR 流程编排]
    end

    subgraph network[@napuketto/network — 协议无关传输]
        BC[EventBroadcaster 泛型广播]
        HTTP[HTTP server/client]
        WS[WS server/client]
    end

    subgraph media[@napuketto/media — 媒体转码]
        SILK[silk-wasm]
        FF[execa + ffmpeg]
        FT[file-type / image-size]
    end

    subgraph adapter[@napuketto/adapter — 协议适配器容器]
        CORE[core: 协议适配器框架]
        OBJ[NapukettoOneBot11Adapter]
        ACT[action: BaseAction + zod 校验]
        OBEV[event: OB11 事件模型]
        DATA[helper: OB11Constructor + CQ 码]
        MSGID[MessageUnique ID 映射]
        OBAPI[api: 缓存聚合]
    end

    CLI --> CORE
    CFG --> CORE
    CORE --> TYPES
    CORE --> LOAD
    CORE --> CH
    CORE --> API
    CORE --> CACHE
    API --> TYPES
    CH --> TYPES
    CORE --> CH
    CORE --> BC
    OBJ --> CORE
    OBJ --> ACT
    OBJ --> DATA
    OBJ --> MSGID
    OBJ --> BC
    ACT --> API
    ACT --> OBAPI
    OBAPI --> CACHE
    ACT --> MEDIA[media 转码]:::x
    subgraph MEDIA[ ]
    end
    MEDIA -.-> SILK
    MEDIA -.-> FF
    MEDIA -.-> FT
    HTTP --> BC
    WS --> BC
```

## 3. 分层原则

| 层 | 职责 | 红线 |
|---|---|---|
| **kernel** | 唯一原生交互层 + 唯一共享状态层 | 其他包禁止直接触碰 `wrapper.node` / session / 原生 listener |
| **network** | 协议无关的传输原语（HTTP/WS + 泛型广播） | 禁止 import 任何协议包；事件类型泛型化 |
| **adapter**（协议容器：core 框架 + onebot11/onebot12/satori） | 协议语义：事件模型、action 注册表、数据翻译、ID 映射 | 只认识 kernel 的 API/事件/缓存，不认识原生 |
| **media** | 媒体编解码与识别 | 只被协议层依赖；kernel 不背媒体依赖 |
| **cli** | 启动编排、登录渲染、配置命令 | 不写业务逻辑，只装配 |

## 4. 核心数据流

### 4.1 调用链（第三方 → QQ）

```
第三方框架 --POST/WS--> network 传输层
  --> adapter 协议适配器（zod 校验）
  --> adapter api 聚合（读 kernel 缓存，缺则调 API）
  --> kernel apis（统一错误语义：成功返业务值 / 失败抛类型化错误）
  --> wrapper.node 原生服务
```

### 4.2 事件链（QQ → 第三方）

```
wrapper.node 原生回调
  --> kernel event-channel（每个 Service 只注册一次原生监听）
      ├── kernel 内部订阅：缓存主动维护
      └── onebot 订阅：翻译为 OB11 事件（只读缓存，纯函数）
          --> network EventBroadcaster 广播给所有 HTTP/WS 适配器
```

## 5. 关键设计决策（ADR 摘要）

完整背景见各包 `docs/design.md` 与对话记录。

| # | 决策 | 否决了什么 | 理由 |
|---|---|---|---|
| ADR-001 | **许可证 GPL-3.0，零引入 NapCat 代码** | 移植 NapCat 类型/实现（GPL-2.0-only 与 GPL-3.0 不兼容） | 法律干净；接口签名是外部系统事实，可自研描述 |
| ADR-002 | **network 协议无关，adapter 依赖 network** | NapCat 的传输层绑定 OB11 类型 | 为 OneBot 12 / Satori 复用传输层 |
| ADR-003 | **类型化事件通道**（EventEmitter + 从 Listener 接口推导签名） | NapCat 的 Proxy + any 老事件系统 | 编译期类型安全；每个 Service 只注册一次原生监听 |
| ADR-004 | **不做 framework 模式** | QQNT 插件运行方式 | 已被证明低效，只做 Shell 模式 |
| ADR-005 | **不做 webui** | 管理面板 | 错误决策；配置走 CLI + JSON + zod |
| ADR-006 | **运行时探测替代逆向** | 静态逆向 QQ 客户端 | 团队无逆向经验；加载 wrapper.node 后反射即可摸清 API 面 |
| ADR-007 | **文件日志用 pino** | log4js（NapCat 方案） | 结构化、性能好、内置 redact |
| ADR-008 | **缓存主动同步 + 只读消费** | NapCat 散落缓存 + 翻译时实时查 API | 翻译层纯函数、无副作用、可并行 |
| ADR-009 | **apis 统一错误语义** | 原生 `{result, errMsg}` 透传 | 协议层错误码映射各写各的，共享同一套错误语义 |
| ADR-010 | **登录状态机在 kernel，渲染在 cli** | 登录逻辑混在启动脚本 | 可单测、可复用；cli 只渲染二维码 |
| ADR-011 | **media 严格解耦** | NapCat 把媒体工具放 common/utils | kernel 不背 ffmpeg/silk 依赖 |
| ADR-012 | **ConfigBase 在 kernel，协议 schema 在协议包** | 协议配置 schema 进 kernel | 协议语义属于各协议包 |
| ADR-013 | **协议适配器统一进 adapter 包（core 框架 + onebot11/onebot12/satori）** | 每个协议一个平级包、翻译各写各的 | 适配器骨架（生命周期/订阅/广播/校验）只写一次，三个协议只需薄映射层 |
| ADR-014 | **adapter 子路径导出（subpath exports）** | 单入口聚合全部协议 | cli 只依赖用到的协议；tree-shaking 友好；`./core` 可被第三方复用 |
| ADR-015 | **多进程多账号，cli 编排** | 单进程多账号 | wrapper 多 session 共存未验证；进程天然隔离，崩一个不影响其他；kernel 保持单账号设计 |
| ADR-016 | **数据目录按账号隔离，放用户目录** | 数据放程序目录 | 程序目录可能只读；多账号天然分离；`NAPKETTO_DATA` → `~/.napuketto` → `--data-dir` 优先级 |
| ADR-017 | **KernelError 类型化错误 + 协议层映射表** | 原生 `{result, errMsg}` 透传（细化 ADR-009） | 错误分类在 kernel 只做一次，协议层只需映射表而非解析逻辑 |
| ADR-018 | **wrapper 版本探测独立模块（wrapper-version）** | 硬编码版本路径 | `wrapper.node` 路径随 QQ 版本变化，登录握手参数（appid/qua）与版本强相关 |

## 6. 路线图

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| **P0 地基** | 类型层（探测脚本 → services/listeners/entities）+ paths/config/logger/event-channel + errors/wrapper-version | `pnpm check` 绿；kernel 能类型化加载 wrapper.node |
| **P1 登录** | wrapper-version 探测 → engine init → QR 登录 → 产出 CoreContext + selfInfo | 终端能登录，日志出现 selfInfo |
| **P2 消息链路** | apis/msg 收发 + adapter 订阅消息事件 + OB11Constructor + network 广播 + send_msg 动作 | 第三方框架经反向 WS 收发消息 |
| **P3 OB11 补全** | 群管/好友/文件动作 + notice/request 事件 + HTTP 上报 + MessageUnique | 跑通 go-cqhttp 兼容大部分接口 |
| **P4 扩展** | 合并转发、OCR/翻译、在线状态、media 接入 | 功能对齐 NapCat 常用面 |
| **P5 多协议（规划）** | onebot12 / satori 协议适配器（adapter 包内新目录，复用 core 框架） | 复用 kernel + network，不改传输层 |
| **P6 多账号（规划）** | cli 子进程编排（`-q` 多账号 / accounts.json 批量） | 多账号并行，进程隔离，单账号逻辑零改动 |

> P5 之后 webui 永远不在路线图上。

## 7. 文档索引

| 文档 | 内容 |
|---|---|
| `AGENTS.md` | 工程指南（约束 / 命令 / 风格 / 实现模式） |
| `packages/kernel/docs/design.md` | kernel：类型层、事件通道、apis、缓存、登录、日志 |
| `packages/network/docs/design.md` | network：传输原语、泛型广播、接口草案 |
| `packages/adapter/docs/design.md` | adapter：协议适配器框架（core）+ onebot11/onebot12/satori |
| `packages/media/docs/design.md` | media：音频/视频/文件识别 |
| `apps/cli/docs/design.md` | cli：启动编排、登录渲染、配置命令 |
