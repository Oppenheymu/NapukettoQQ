/**
 * tsdown.config.ts：@napuketto/loader 双构建（2026-08-07 阶段 2）。
 *
 * 配置 1 —— 对外 API（index）：ESM + d.mts，与阶段 1 前行为一致（构建时清 dist）。
 * 配置 2 —— 自建宿主引导运行时（host/self-host）：CJS 单文件 bundle，
 *   rolldown 将 src/host/ 依赖树（bootstrap/login/session/protocols/smoke/util/
 *   types/env）全部内联进 dist/host/self-host.cjs，node 内置模块保持 external。
 *   产物被 launcher.launchSelfHost() spawn 直接执行（node dist/host/self-host.cjs），
 *   .cjs 扩展名自声明 CommonJS（包根 "type": "module"），无需再复制 runtime 目录。
 */
import { defineConfig } from "tsdown";

export default defineConfig([
    {
        // 对外 API（apps/cli 消费）：ESM，保持现状
        entry: { index: "src/index.ts" },
        format: ["esm"],
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
