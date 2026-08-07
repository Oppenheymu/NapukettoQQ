// 复制自建宿主运行时（runtime/ → dist/native/runtime/）
// 注：V1 注入框架（bootmain/hookdll）与 V2 载具（vehicle）已归档 archive/，
// 当前唯一路线为自建宿主（标准 node + stub QQNT.dll），仅需复制 JS 运行时。
// 用法：node scripts/build-native.mjs
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..");
const DIST_DIR = join(PACKAGE_ROOT, "dist", "native");

/** 整个 runtime 目录递归复制（self-host.cjs 入口 require 同目录模块）。 */
function copyRuntime() {
    const runtimeDir = join(PACKAGE_ROOT, "runtime");
    const runtimeOut = join(DIST_DIR, "runtime");
    if (!existsSync(runtimeDir)) {
        console.warn(`[build-native] 缺少 runtime 目录: ${runtimeDir}`);
        return;
    }
    mkdirSync(runtimeOut, { recursive: true });
    cpSync(runtimeDir, runtimeOut, { recursive: true, force: true });
    console.log(`[build-native] OK: ${runtimeOut}（自建宿主运行时）`);
}

copyRuntime();
console.log("[build-native] 完成");
