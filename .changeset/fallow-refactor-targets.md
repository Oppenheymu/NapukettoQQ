---
"@napuketto/kernel": patch
"@napuketto/adapter": patch
---

按 fallow 建议重构 4 个 untested-risk 目标（先建 vitest 测试设施写基线，重构后回归）：

- **测试设施**：根 `vitest.config.ts` + `pnpm test`（59 用例覆盖 4 个重构模块）
- **kernel/result.ts**：unwrapResult 错误码映射链 → `RESULT_CODE_RULES` 查找表 + `mapResultCode` 纯函数（cyclomatic 10 → 4）
- **kernel/probe-serialize.ts**：serialize 分支拆 `serializeContainer`/`serializeArray`/`serializeMap`/`serializeSet`/`serializeObject`（cyclomatic 16 → 6）
- **adapter/segment.ts**：canonicalToSegment/segmentToCanonical if 链 → 判别式转换器映射表（cyclomatic 12/11 → 1/2）
- **adapter/element-convert.ts**：elementToCanonical switch → 元素转换器映射表；媒体元素转换器（img/audio/video/file）拆分到 `media-convert.ts`

全部为行为等价重构（59 测试回归通过，无 API 变化）。
