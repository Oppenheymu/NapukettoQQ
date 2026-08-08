---
"@napuketto/kernel": patch
"@napuketto/adapter": patch
"@napuketto/loader": patch
---

DDD 目录重组（纯移动 + barrel，行为零变化，2026-08-08）：

- **kernel**：`wrapper/` 拆出 `wrapper/probe/`（运行时反射探测子系统 5 文件 + barrel）；`index.ts` 改指 probe barrel
- **adapter**：`satori/helper/` 拆出 `helper/element/`（消息元素域 7 文件 + barrel：解析/渲染/双向转换/资源）；`onebot11/helper/` 拆出 `helper/codec/`（CQ 编解码域 3 文件 + barrel）
- **loader**：`host/` 拆出 `host/core/`（自建宿主引导编排 7 文件）；tsdown 入口与 `.fallowrc` manual entry 同步改 `host/core/self-host.ts`（产物 `dist/host/self-host.cjs` 路径不变，launcher 默认值无需改）

全部为 git mv 文件移动 + import 路径调整（组内相对引用保持，跨目录走 barrel），`pnpm check` / 59 测试 / 全量构建 / fallow 全绿，无 API 变化。
