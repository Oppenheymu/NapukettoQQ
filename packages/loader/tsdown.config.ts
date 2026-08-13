/**
 * tsdown.config.ts：@napuketto/loader 双构建（2026-08-07 阶段 2；2026-08-13 对外 API 双格式）。
 *
 * 配置 1 —— 对外 API（index）：**ESM + CJS 双格式** + d.mts/d.cts（2026-08-13）。
 *   背景：koishi 适配器发布形态是 CJS，koishi loader 用 require() 加载 →
 *   适配器 require loader。仅 ESM 会 ERR_REQUIRE_ESM，故与 kernel 同步输出
 *   dist/index.cjs（exports.require 指向），ESM 消费方（apps/cli）仍走
 *   dist/index.mjs。构建时清 dist。
 * 配置 2 —— 自建宿主引导运行时（host/self-host）：CJS 单文件 bundle，
 *   rolldown 将 src/host/ 依赖树（bootstrap/login/session/protocols/smoke/util/
 *   types/env）全部内联进 dist/host/self-host.cjs，node 内置模块保持 external。
 *   产物被 launcher.launchSelfHost() spawn 直接执行（node dist/host/self-host.cjs），
 *   .cjs 扩展名自声明 CommonJS（包根 "type": "module"），无需再复制 runtime 目录。
 */
import { defineConfig } from "tsdown";

export default defineConfig([
    {
        // 对外 API（apps/cli、koishi 适配器消费）：ESM + CJS 双格式
        entry: { index: "src/index.ts" },
        format: ["esm", "cjs"],
        platform: "node",
        clean: true,
    },
    {
        // 自建宿主引导运行时：CJS 单文件（launcher spawn 入口）
        entry: { "host/self-host": "src/host/core/self-host.ts" },
        format: ["cjs"],
        platform: "node",
        // 避免第二个构建清掉 index 产物（第一个配置已 clean）
        clean: false,
        // host 是内部入口，不需要对外类型声明
        dts: false,
    },
]);
