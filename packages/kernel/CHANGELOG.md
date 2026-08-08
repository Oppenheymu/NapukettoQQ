# @napuketto/kernel

## 0.0.2

### Patch Changes

- 564e383: Barrel 规范化整理（纯结构重构，行为零变化，2026-08-08）：

  - **kernel**：`infra/`、`types/`（含 `listeners/`、`services/` 子 barrel）、`login/`、
    `bridge/`、`apis/` 各建 `index.ts` barrel；`index.ts` 与全 kernel 跨目录引用改走 barrel，
    同目录组内引用保持相对路径（`./result.js` 等）
  - **adapter**：`onebot11/action/index.ts` 升级为真正 barrel（re-export 全部 79 个动作类 +
    error-map + resolve-uid + Ob11ActionDeps + createOb11ActionRegistry）；`onebot11/api/`、
    `satori/api/` 单文件建统一入口；`satori/helper/` 建 barrel（config/error/ids/translate，
    element 子域独立 barrel 不绕行）
  - 包对外 API 签名不变（`packages/*/src/index.ts` 导出面未动）；`.fallowrc.jsonc`
    按 codec/element 先例补充新 barrel 的 ignoreFindings（目录公共面 re-export）

  `pnpm check` / 59 测试 / 全量构建 / fallow（dead files 0%、dead exports 0%）全绿。

- b9f06ca: DDD 目录重组（纯移动 + barrel，行为零变化，2026-08-08）：

  - **kernel**：`wrapper/` 拆出 `wrapper/probe/`（运行时反射探测子系统 5 文件 + barrel）；`index.ts` 改指 probe barrel
  - **adapter**：`satori/helper/` 拆出 `helper/element/`（消息元素域 7 文件 + barrel：解析/渲染/双向转换/资源）；`onebot11/helper/` 拆出 `helper/codec/`（CQ 编解码域 3 文件 + barrel）
  - **loader**：`host/` 拆出 `host/core/`（自建宿主引导编排 7 文件）；tsdown 入口与 `.fallowrc` manual entry 同步改 `host/core/self-host.ts`（产物 `dist/host/self-host.cjs` 路径不变，launcher 默认值无需改）

  全部为 git mv 文件移动 + import 路径调整（组内相对引用保持，跨目录走 barrel），`pnpm check` / 59 测试 / 全量构建 / fallow 全绿，无 API 变化。

- 8e64508: 按 fallow 建议重构 4 个 untested-risk 目标（先建 vitest 测试设施写基线，重构后回归）：

  - **测试设施**：根 `vitest.config.ts` + `pnpm test`（59 用例覆盖 4 个重构模块）
  - **kernel/result.ts**：unwrapResult 错误码映射链 → `RESULT_CODE_RULES` 查找表 + `mapResultCode` 纯函数（cyclomatic 10 → 4）
  - **kernel/probe-serialize.ts**：serialize 分支拆 `serializeContainer`/`serializeArray`/`serializeMap`/`serializeSet`/`serializeObject`（cyclomatic 16 → 6）
  - **adapter/segment.ts**：canonicalToSegment/segmentToCanonical if 链 → 判别式转换器映射表（cyclomatic 12/11 → 1/2）
  - **adapter/element-convert.ts**：elementToCanonical switch → 元素转换器映射表；媒体元素转换器（img/audio/video/file）拆分到 `media-convert.ts`

  全部为行为等价重构（59 测试回归通过，无 API 变化）。

- 9005c43: koishi 适配器 IPC 子进程模式前置（§7 loader 去脚本化，2026-08-08）：

  - **kernel**：`NTEventChannel` 新增 `onAny`（全事件订阅，IPC 整通道转发用）；
    `CoreLoginOptions` 新增 `onLoginProgress` 回调（QR 阶段二维码/状态机转发）；
    `LoginProgress` 类型导出
  - **loader**：新增 `src/host/ipc/`（NAPUTO_IPC=1 开启）——协议类型/编解码/发送封装/
    动作表（msg/group/friend 核心动作，peerUin 自动转 uid）/stdin 服务端（action/control/
    心跳）；`self-host.ts` IPC 分支发 status（booting→dlopening→logging→sessioning→ready/
    failed）；`protocols.ts` 重构拆出 `kernel-services.ts`（服务创建，IPC/协议共用）+
    `assemble-protocols.ts`（OB11/Satori 装配，非 IPC 零回归）；`launcher.ts` 新增
    `LaunchOptions.ipc`（注入 NAPUTO_IPC=1）

  非 IPC 路径（cli pnpm start）行为零变化；`pnpm check` / 198 测试全绿。
