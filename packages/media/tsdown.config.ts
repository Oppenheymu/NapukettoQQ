/**
 * tsdown.config.ts：@napuketto/media 双格式构建（2026-08-24 生产事故修复）。
 *
 * 产物：dist/index.mjs（ESM）+ dist/index.cjs（CJS）+ 类型声明（d.mts / d.cts）。
 *
 * 背景：koishi 适配器（koishi-plugin-adapter-napuketto）发布形态是 CJS
 * （lib/index.cjs），koishi loader 用 require() 加载插件 → 适配器 CJS 产物
 * require media（语音发送前统一转 silk，2026-08-23 引入）。此前 media 仅 ESM
 * （exports 只有 import 条件），CJS require 解析不到入口，生产报
 * ERR_PACKAGE_PATH_NOT_EXPORTED。修复：与 kernel/loader 一致，双格式 +
 * exports 补 require 条件。
 *
 * ESM-only 依赖处理：execa（v10）、file-type（v22）无 CJS 入口——CJS 产物
 * require 它们会抛 ERR_REQUIRE_ESM（Node <22.12）。用 deps.alwaysBundle
 * 强制打进 CJS 产物（同时 ESM 产物也内联，无碍——ESM 消费方不受影响）。
 * image-size（双格式）、silk-wasm（CJS）保持 external（默认），CJS require
 * 可正常加载。
 */
import { defineConfig } from "tsdown";

export default defineConfig({
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    platform: "node",
    clean: true,
    dts: true,
    deps: {
        alwaysBundle: ["execa", "file-type"],
    },
});
