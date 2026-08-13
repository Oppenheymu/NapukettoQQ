/**
 * tsdown.config.ts：@napuketto/kernel 双格式构建（2026-08-13）。
 *
 * 产物：dist/index.mjs（ESM）+ dist/index.cjs（CJS）+ 类型声明（d.mts / d.cts）。
 *
 * 背景：koishi 适配器（koishi-plugin-adapter-napuketto）发布形态是 CJS
 * （lib/index.cjs），koishi loader 用 require() 加载插件 → 适配器 CJS 产物
 * require kernel。若 kernel 仅 ESM（.mjs），Node 抛 ERR_REQUIRE_ESM。
 * 双格式是基础库标准做法：ESM 消费方（apps/cli 自建宿主）走 import → .mjs；
 * CJS 消费方（koishi 适配器等）走 require → .cjs。
 *
 * 依赖（pino / pino-pretty / smol-toml）保持 external——三者均提供 CJS 入口，
 * CJS 产物 require 可正常加载。`import.meta.url`（infra/paths.ts）由 rolldown
 * 在 CJS 输出中转换为基于 __filename 的等价形式，定位行为不变（均在 dist/ 下）。
 */
import { defineConfig } from "tsdown";

export default defineConfig({
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    platform: "node",
    clean: true,
    dts: true,
});
