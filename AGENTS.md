# NapukettoQQ 工程指南

> 本文件是项目级指令（VS Code Copilot 自动加载）。开始任何工作前，先读本文件与 `docs/architecture.md`，再读对应包的 `docs/design.md`。

## 项目是什么

NapukettoQQ：基于 QQ NT 客户端原生模块（`wrapper.node`）的机器人框架，对外提供 OneBot 11（当前）、OneBot 12 / Satori（规划）多协议接口。**全自研**，pnpm monorepo + TypeScript + tsdown + biome。

## 硬性约束（违反 = 错误）

1. **许可证 GPL-3.0，零引入 NapCat 代码**。NapCat 是 GPL-2.0-only，与 GPL-3.0 不兼容，任何文件（含类型定义）都不得复制或移植。接口签名是外部系统（腾讯 wrapper.node）的事实，可以自研描述，但架构与实现必须原创。
2. **依赖方向**（只允许向下依赖）：

   ```
   @napuketto/kernel    无内部依赖（仅 pino）
   @napuketto/media     无内部依赖
   @napuketto/network   无内部依赖（协议无关传输原语）
   @napuketto/adapter   kernel + network + media（协议适配器容器：core 框架 + onebot11/onebot12/satori）
   apps/cli             kernel + adapter
   ```

3. **kernel 是唯一原生交互层**：只有 `packages/kernel` 允许 `process.dlopen`、访问 `wrapper.node`、注册原生 listener。其他包只能调 kernel 的语义化 API、订阅事件通道、读缓存。
4. **network 协议无关**：`@napuketto/network` 不得 import 任何协议包（adapter 等），事件类型必须泛型化。
5. **不做的事**：framework 模式（QQNT 插件）、webui、NapCat 的 Proxy 事件老方案、无理由的 `any`。
6. **media 严格解耦**：`@napuketto/media` 只被协议层（adapter）依赖，kernel 不背媒体依赖。

## 工作流

```bash
pnpm install            # 安装依赖
pnpm check              # biome check + tsc --noEmit（提交前必跑）
pnpm fix                # biome 自动修复 + tsc
pnpm -r build           # 全量构建（tsdown）
pnpm --filter @napuketto/kernel dev   # 单包 watch 构建
```

## 代码风格（biome 已强制，手动也须遵守）

- 缩进 **space+4**，行尾 **LF**（Windows 下 CRLF 会被 biome 修复）。
- 类型安全：`strict` 全家桶、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`verbatimModuleSyntax`、`noUnusedLocals/Parameters` 均为 error。
- 类型导入一律 `import type`；禁止 `any`（例外必须注释说明原因）。
- `noFloatingPromises` 为 error：异步调用必须 `await` 或显式 `.catch`。
- 错误处理：业务错误抛类型化错误，不静默吞掉；日志统一走 pino。

## 实现模式（重要）

- **一个模块一个模块实现**：开工前先读 `docs/architecture.md` 与对应包的 `docs/design.md`，按其中的「实现顺序」推进，不跨模块跳跃；每完成一个模块跑一次 `pnpm check`。
- **类型层来自运行时探测**：`services/listeners/entities` 的类型通过加载 `wrapper.node` 后的运行时反射 + 实体 JSON 日志观察产出，不是拍脑袋或抄别家。探测脚本放 `packages/kernel/scripts/probe/`。
- **新增协议**（OneBot 12 / Satori）→ 在 `packages/adapter` 内新增 `onebot12/`、`satori/` 目录，复用 core 框架（生命周期/订阅/广播/校验），**不改 network、不改 kernel**。
- **写代码前先更新对应包的 `docs/design.md`**，设计先行。

## 环境

- Node.js（ESM，`"type": "module"`）；TypeScript `NodeNext` 解析；包名统一 `@napuketto/*`。
