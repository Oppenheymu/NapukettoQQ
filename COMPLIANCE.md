# NapukettoQQ 合规声明

> 更新时间：2026-08-06。本文件记录项目的许可证合规状态与审计方法，随
> 许可证变更同步更新。

## 1. 许可证

- **开源部分**：MIT License（见根目录 `LICENSE`）。
- **私有部分**：`packages/loader` 的载具（`native-private/`、`vehicle.cpp`、
  载具二进制）为私有资产，不适用 MIT（见 `NOTICE`）。

## 2. 零 NapCat 代码声明

本项目不包含 NapCat（GPL-2.0-only）的任何代码、类型定义或二进制。审计依据：

| 项 | 方法 | 状态 |
|---|---|---|
| 依赖树 | `pnpm list` / node_modules package.json 许可证扫描 | ✅ 无 GPL/AGPL/SSPL 依赖 |
| 代码引用 | 全局 grep `napcat`，全部为注释中的「接口签名是外部系统事实，自研描述」说明 | ✅ 无 import/复制 |
| 相似度 | 代码为自研实现（中文设计注释、独立模块边界、完整错误处理） | ✅ 无逐行翻译痕迹 |

接口签名（方法名/参数/返回形状/事件字段）是 QQ `wrapper.node` 外部系统的事实，
依据互操作原则自研描述，不构成对 NapCat 的复制。

## 3. 逆向产物管理

- Ghidra 分析产物（RVA/Offset 表）**不提交公共仓库**，仅存私有。
- 载具源码（`native-private/`、`vehicle.cpp`）由 `.gitignore` 排除。
- 载具 DLL 混淆/加壳后分发，源码不开源。

## 4. 第三方依赖许可证清单（2026-08-06 扫描）

运行时依赖均为宽松许可证（MIT / ISC / BSD / Apache-2.0 / MPL-2.0 等），
无 copyleft 传染风险：

| 依赖 | 许可证 | 备注 |
|---|---|---|
| pino / pino-pretty | MIT | kernel |
| smol-toml | MIT | kernel |
| hono / @hono/node-server | MIT | network |
| ws | MIT | network |
| fast-xml-parser | MIT | adapter |
| zod | MIT | adapter |
| execa / file-type / image-size / silk-wasm | MIT | media |
| commander / picocolors / qrcode | MIT | cli |
| lightningcss-android-arm64 | **MPL-2.0** | vitest→vite 传递 devDependency，平台不相关，不进入发布物 |
| @biomejs/biome / tsdown / typescript / vitest | MIT | devDependencies |

> MPL-2.0 为文件级弱 copyleft，仅用于开发期构建工具链，不进入产物，
> 与 MIT 兼容。

## 5. 审计方法（可重复执行）

```bash
# 依赖树许可证扫描（发现 copyleft 依赖）
pnpm list --depth 4
# 代码引用扫描（确认零引入）
grep -rniE "napcat" packages/ --include="*.ts" --include="*.cjs" --include="*.cpp"
```
