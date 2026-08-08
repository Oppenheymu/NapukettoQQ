/**
 * Vitest 配置（2026-08-08 fallow 重构引入）
 *
 * fallow 的 refactoring targets 标注「untested risk · add tests before
 * modifying」——先建测试设施写基线，再在测试保护下重构。
 *
 * 测试文件放在各包 src/ 内（与源码相邻，biome + tsc 自动纳入检查），
 * 只测包内纯函数（相对路径导入，不依赖跨包构建产物）。
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
        environment: "node",
    },
});
