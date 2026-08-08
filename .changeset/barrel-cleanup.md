---
"@napuketto/kernel": patch
"@napuketto/adapter": patch
---

Barrel 规范化整理（纯结构重构，行为零变化，2026-08-08）：

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
