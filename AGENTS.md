# NapukettoQQ 工程指南

> 本文件是项目级指令（VS Code Copilot 自动加载）。开始任何工作前，先读本文件与 `docs/STATUS.md`（现状 + 关键决策点）→ `docs/architecture.md`（架构书）→ 对应包的 `docs/design.md`。

## 项目是什么

NapukettoQQ：基于 QQ NT 客户端原生模块（`wrapper.node`）的机器人框架，对外提供 OneBot 11（当前）、Satori（规划）多协议接口（**OneBot 12 已放弃**，规范过于模糊）。**全自研**，pnpm monorepo + TypeScript + tsdown + biome。

## 硬性约束（违反 = 错误）

1. **许可证 MIT（2026-08-06 由 GPL-3.0 迁移），零引入 NapCat 代码**。NapCat 是 GPL-2.0-only，与 MIT 不兼容，任何文件（含类型定义）都不得复制或移植。接口签名是外部系统（腾讯 wrapper.node）的事实，可以自研描述，但架构与实现必须原创。
   **闭源例外**：`@napuketto/loader` 的 V2 载具（Native Bypass DLL，`native-private/`）为私有组件——逆向腾讯 QQ 的产物（RVA/Offset 表）绝不进公共仓库，仅分发编译+混淆后的二进制；公共仓库只含注入框架。
2. **依赖方向**（只允许向下依赖）：

   ```
   @napuketto/kernel    无内部依赖（仅 pino + smol-toml）
   @napuketto/media     无内部依赖
   @napuketto/network   无内部依赖（协议无关传输原语）
   @napuketto/adapter   kernel + network + media（协议适配器容器：core 框架 + onebot11/satori）
   @napuketto/loader    kernel（boot 引导）+ 无其他（唯一 C++ 组件：注入 + 引导 + Native Bypass 载具）
   apps/cli             kernel + adapter + loader
   ```

3. **kernel 是唯一原生交互层**：只有 `packages/kernel` 允许 `process.dlopen`、访问 `wrapper.node`、注册原生 listener。其他包只能调 kernel 的语义化 API、订阅事件通道、读缓存。
4. **network 协议无关**：`@napuketto/network` 不得 import 任何协议包（adapter 等），事件类型必须泛型化。
5. **不做的事**：framework 模式（QQNT 插件）、webui、插件系统、NapCat 的 Proxy 事件老方案、无理由的 `any`。**功能范围 = NapCat 全部能力（协议 + API）− WebUI − 插件系统**（2026-08-06 用户拍板）。
6. **media 严格解耦**：`@napuketto/media` 只被协议层（adapter）依赖，kernel 不背媒体依赖。
7. **技术路线（2026-08-06 定稿，V2：Native C++ Bypass 载具 + NAPI 业务层混合模式）**：
   - **⚠️ 关键决策点**：先读 `docs/STATUS.md` 顶部——**自建宿主按「可救」规划**（标准 Node 纯 Node 模式，NapCat 实证 ~237MB），路线 B（注入 worker）为已验证兜底。
   - **完整架构书**：`docs/architecture.md`（分层/ADR/路线图/红线/工具链，新对话必读）。
   - **业务层（JS/NAPI）**：kernel/adapter/network/media/cli 继续纯 NAPI 调用 `wrapper.node` 业务 API（getMsgService 等），现有 78 个 OneBot 动作全保留。
   - **载具层（C++ Native，私有）**：`@napuketto/loader` 负责注入引导（**复用 V1 bootmain/hookdll 基础设施**）+ 无头阻断。路线 B（已验证）：注入 QQ 主进程 → fork utilityProcess Worker（继承 QQ env）→ worker 内 dlopen；自建宿主（主攻，待验证）：标准 Node + QQNT.dll + 窗口类。载具 DLL 职责：① NOP `wrapper.node` 环境自检与 self-register 校验 ② 激活 session `cpp_impl`（路线 B 用不上）③ 阻断 Chromium UI/GPU/Renderer 进程（无头 + 低内存）。
   - **⚠️ 逆向边界（2026-08-06 用户拍板：允许必要逆向，非 0 逆向）**：
     - **允许逆向的用途**（与 NapCat 能力对齐所需）：
       a. **环境模拟/反风控**：进程名伪装、模块隐藏（K32EnumProcessModules/GetModuleHandleW）、内存 RWX→RX、窗口类（自建宿主必需，napi2native 自研等价物）
       b. **数据包层**：C++ 层 hook 数据包 send/recv（Frida Gum 等价物，数据包监控/协议分析）
       c. **无头阻断**：内存中阻断 UI/GPU/Renderer 进程降内存
       d. **模拟触发 `cpp_impl` 激活信号**（旧载具职责保留）
     - **业务层优先 NAPI（优先级而非禁令）**：收发消息/事件监听/数据解析**优先**走官方 NAPI 导出接口（稳定、简单、可维护）；仅当 NAPI 无法覆盖的能力（数据包层、环境模拟）才用 C++ 逆向补足。
     - **技术手段不设限**：允许 koffi / vtable 槽位 / 内存偏移 / thiscall 裸调等逆向手段——但**仅限 C++ 载具层（loader）**，业务层（kernel/adapter）仍不得直接使用（版本脆弱性，不是合规问题）。
     - **绝对禁止（许可证底线，不变）**：复制/移植 NapCat 代码（GPL-2.0-only 与 MIT 不兼容），任何文件（含类型定义）不得来自 NapCat。
   - **零磁盘篡改**：内存 Patch 仅在 QQ.exe 运行期 RAM 生效，**严禁修改/覆盖磁盘上 QQ 安装目录任何二进制**（QQNT.dll / wrapper.node / package.json / asar）；升级/卸载零残留。
   - **逆向产物管理**：Ghidra 分析（RVA 表/Offset）不提交公共仓库，仅存私有；`scripts/probe/` 旧 koffi 脚本仅作历史参考。
8. **全局配置 = 单一 TOML 文件**（2026-08-05 用户拍板）：所有配置统一放 `<数据根>/napuketto.toml`（主配置段 + `[onebot11]` 等协议段），**不再使用独立 JSON 配置文件**（JSON 门槛太高）。kernel `ConfigBase` 支持 TOML（smol-toml 解析/序列化，按 `.toml` 扩展名推断）+ `seed`（内存初值：boot.cjs 从全局 TOML 取协议段 zod 校验后作 seed，adapter 不再读独立协议文件）。cli `config init/list/apply` 读写该文件。

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

- **一个模块一个模块实现**：开工前先读 `docs/STATUS.md` 与 `docs/architecture.md`、对应包的 `docs/design.md`，按其中的「实现顺序」推进，不跨模块跳跃；每完成一个模块跑一次 `pnpm check`。
- **类型层来自运行时探测**：`services/listeners/entities` 的类型通过加载 `wrapper.node` 后的运行时反射 + 实体 JSON 日志观察产出，不是拍脑袋或抄别家。探测脚本放 `packages/kernel/scripts/probe/`。
- **kernel 无全局单例**（ADR-015 推论）：logger / cache / event-channel 等都是实例化对象，由 `CoreContext` 持有——多账号多进程场景每进程一份，避免跨账号状态污染。
- **新增协议**（Satori）→ 在 `packages/adapter` 内新增 `satori/` 目录，复用 core 框架（生命周期/订阅/广播/校验），**不改 network、不改 kernel**。
- **写代码前先更新对应包的 `docs/design.md`**，设计先行。

## 环境

- Node.js（ESM，`"type": "module"`）；TypeScript `NodeNext` 解析；包名统一 `@napuketto/*`。
