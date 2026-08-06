/**
 * smoke-test：验证 loader 核心链路（locate-qq / stage / launch）前置条件。
 *
 * 安全设计：默认**不真正拉起 QQ**（避免弹窗 + 注入真实环境）。
 *  - locate-qq：真实探测（只读注册表/文件系统）
 *  - stage：真实复制依赖到临时目录 + 清理（不动 QQ 安装目录）
 *  - launch：只验证产物存在 + env 构造正确，不 spawn
 * 传 `--real` 才真正执行 launchQqWithLoader（会拉起 QQ + 注入 hook DLL）。
 *
 * 用法：node scripts/smoke-test.mjs [--real]
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const REAL = process.argv.includes("--real");

// loader 的 dist 入口（需先 pnpm --filter @napuketto/loader build）
const loaderEntry = join(PKG_ROOT, "dist", "index.mjs");
if (!existsSync(loaderEntry)) {
    console.error(`[smoke] loader dist 缺失: ${loaderEntry}（先跑 pnpm --filter @napuketto/loader build）`);
    process.exit(1);
}

const loader = await import("file://" + loaderEntry.replace(/\\/g, "/"));

let failures = 0;
function check(name, ok, detail = "") {
    if (ok) {
        console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
    } else {
        failures += 1;
        console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

console.log("== locate-qq ==");
let qq = null;
try {
    qq = loader.resolveQqInstall();
    check("resolveQqInstall", true, `QQ=${qq.qqPath}`);
    check("wrapper.node 存在", existsSync(qq.wrapperPath), qq.wrapperPath);
    check("版本", qq.version.length > 0, qq.version);
} catch (e) {
    check("resolveQqInstall", false, e.message);
}

console.log("== stage ==");
let stage = null;
if (qq) {
    try {
        stage = loader.stageWrapper(qq.wrapperPath);
        const files = ["wrapper.node", "QQNT.dll", "ffmpeg.dll"];
        const present = files.filter((f) => existsSync(join(stage.dir, f)));
        check("stageWrapper 复制", present.length > 0, `${present.length}/${files.length} 个关键文件: ${present.join(", ")}`);
        check("临时目录", stage.dir.length > 0, stage.dir);
    } catch (e) {
        check("stageWrapper", false, e.message);
    }
}

console.log("== launch（dry-run）==");
if (qq) {
    const nativeDir = join(PKG_ROOT, "dist", "native");
    const bootMain = join(nativeDir, "NapukettoBootMain.exe");
    const hookDll = join(nativeDir, "NapukettoWinBootHook.dll");
    const bootJs = join(nativeDir, "runtime", "boot.cjs");
    const kernelEntry = join(PKG_ROOT, "..", "kernel", "dist", "index.mjs");

    check("BootMain.exe 产物", existsSync(bootMain), bootMain);
    check("HookDll.dll 产物", existsSync(hookDll), hookDll);
    check("boot.cjs 产物", existsSync(bootJs), bootJs);
    check("kernel dist 存在", existsSync(kernelEntry), kernelEntry);

    // 校验 kernel 导出 startNapuketto（boot.cjs 依赖）
    if (existsSync(kernelEntry)) {
        try {
            const kernel = await import("file://" + kernelEntry.replace(/\\/g, "/"));
            check("kernel 导出 startNapuketto", typeof kernel.startNapuketto === "function");
            check("kernel 导出 createWrapper", typeof kernel.createWrapper === "function");
        } catch (e) {
            check("kernel 导入", false, e.message);
        }
    }

    // boot.cjs 里读的环境变量与 launcher.ENV 一致性
    const expected = [
        ["NAPUTO_QQ_PATH", "QQ_PATH"],
        ["NAPUTO_BOOT_JS", "BOOT_JS"],
        ["NAPUTO_HOOK_DLL", "HOOK_DLL"],
        ["NAPUTO_KERNEL_ENTRY", "KERNEL_ENTRY"],
        ["NAPUTO_CFG_DIR", "CFG_DIR"],
        ["NAPUTO_QQ_VERSION", "QQ_VERSION"],
        ["NAPUTO_WRAPPER_PATH", "WRAPPER_PATH"],
    ];
    const envKeys = loader.ENV ?? {};
    check("ENV 定义齐全", expected.every(([name, key]) => envKeys[key] === name));

    if (REAL) {
        console.log("== launch（--real，真正拉起 QQ）==");
        try {
            const result = loader.launchQqWithLoader({
                qq,
                kernelEntry,
                cfgDir: join(PKG_ROOT, ".smoke-cfg"),
            });
            check("launchQqWithLoader", true, `pid=${result.child.pid ?? "n/a"}`);
            console.log("  注意：QQ 已拉起并注入，检查 dist/native 与 QQ 进程后手动关闭。");
        } catch (e) {
            check("launchQqWithLoader", false, e.message);
        }
    } else {
        console.log("  （dry-run：产物与 env 已验证，传 --real 才真正拉起 QQ）");
    }
}

// 清理 stage 临时目录
if (stage) {
    try {
        loader.cleanupStage(stage);
        check("cleanupStage 清理", true);
    } catch (e) {
        check("cleanupStage", false, e.message);
    }
}

console.log(failures === 0 ? "\n✅ smoke-test 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
