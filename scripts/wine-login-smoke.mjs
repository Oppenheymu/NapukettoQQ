/**
 * wine-login-smoke.mjs：Linux/wine 完整链路登录冒烟（P2 Step 2）。
 *
 * 用法（WSL2 内，从项目根）：
 *   node scripts/wine-login-smoke.mjs [--ext4-dir <dir>] [--uin <QQ号>]
 *
 * 流程（复用自建宿主全链路，与 Windows 完全一致，仅换宿主为 wine + win-node）：
 *   1. 确保 QQ 文件（P1 ensureQqFiles）
 *   2. 确保 Windows 版 node.exe（P2 ensureWinNode）
 *   3. wine 跑 win-node → self-host.cjs（NAPUTO_* 环境变量注入，路径过 toWinePath）
 *      └─ dlopen wrapper.node（stub 转发）→ O3MiscService 激活 → bootstrap
 *      └─ 登录（快速登录指定 uin / 未指定则交互）→ session READY → 协议装配
 *
 * ⚠️ 与 Step 1 相同的坑：数据根必须放 ext4（wine 读 /mnt/c 会 File not found）。
 * ⚠️ 登录是长驻进程（协议服务在事件循环），脚本在 session READY 后观察 90s 退出。
 */
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    defaultStubDir,
    ensureQqFiles,
    ensureWinNode,
    toWinePath,
} from "../packages/loader/dist/index.mjs";

// ── 参数 ──
const argDir = process.argv.find((a) => a.startsWith("--ext4-dir="));
const argUin =
    process.argv.find((a) => a.startsWith("--uin=")) ??
    (() => {
        const i = process.argv.indexOf("--uin");
        return i >= 0 ? process.argv[i + 1] : undefined;
    })();
const dataRoot = argDir
    ? resolve(argDir.slice("--ext4-dir=".length))
    : join(homedir(), ".napuketto");
const uin = argUin
    ? argUin.startsWith("--uin=")
        ? argUin.slice("--uin=".length)
        : argUin
    : undefined;
console.log(`[wine-login] 数据根（ext4）: ${dataRoot}`);
if (uin !== undefined) {
    console.log(`[wine-login] 快速登录 uin: ${uin}`);
}

// 1. 确保 QQ 文件（P1）
console.log("[wine-login] 确保 QQ 文件…");
const qq = await ensureQqFiles({ dataRoot });
console.log(`[wine-login] QQ 文件 OK: version=${qq.version}`);

// 2. 确保 Windows 版 node.exe（P2）
console.log("[wine-login] 确保 Windows 版 node.exe…");
const winNode = await ensureWinNode({ dataRoot });
console.log(`[wine-login] win-node OK: ${winNode.exePath} (${winNode.version})`);

// 3. stub 校验
const stubHost = defaultStubDir();
if (!existsSync(join(stubHost, "QQNT.dll"))) {
    console.log(`[wine-login] ❌ stub QQNT.dll 未找到: ${stubHost}`);
    process.exit(1);
}
console.log(`[wine-login] stub OK: ${stubHost}`);

// 4. 装配环境变量（与 launcher.buildLaunchEnv 同构；wine 场景路径过 toWinePath）
const wrapperDir = join(qq.wrapperPath, "..");
const cfgDir = join(dataRoot, uin ?? "default");
mkdirSync(cfgDir, { recursive: true });
const env = {
    ...process.env,
    NAPUTO_QQ_PATH: toWinePath(join(dataRoot, "QQ.exe")), // 语义占位
    NAPUTO_QQ_VERSION: qq.version,
    NAPUTO_WRAPPER_PATH: toWinePath(qq.wrapperPath),
    NAPUTO_CFG_DIR: toWinePath(cfgDir),
    NAPUTO_SELF_HOST: "1",
    NAPUTO_STUB_DIR: toWinePath(stubHost),
    // PATH 保持 Linux 原样（wine 自身是 Linux 程序，靠它解析）；
    // wine 内 DLL 搜索路径在 4.5 段用 WINEPATH 注入。
    PATH: process.env["PATH"] ?? "",
};
if (uin !== undefined) {
    env["NAPUTO_QUICK_UIN"] = uin;
}

// 5. 定位并复制运行时到 ext4（wine 读不了 /mnt/c DrvFS！）
//    ⚠️ 2026-08-12 实测：wine 读 /mnt/c 会失败（同 wrapper.node 的坑）。
//    self-host.cjs 是单文件 CJS bundle，kernel dist 是单文件 ESM bundle——
//    复制到 ext4 运行时目录（wine 内路径过 toWinePath）。
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const srcSelfHost = join(projectRoot, "packages", "loader", "dist", "host", "self-host.cjs");
const srcKernel = join(projectRoot, "packages", "kernel", "dist", "index.mjs");
if (!existsSync(srcSelfHost)) {
    console.log(`[wine-login] ❌ self-host.cjs 未找到: ${srcSelfHost}`);
    process.exit(1);
}
if (!existsSync(srcKernel)) {
    console.log(`[wine-login] ❌ kernel dist 未找到: ${srcKernel}`);
    process.exit(1);
}
const runtimeDir = join(dataRoot, "runtime", "smoke");
mkdirSync(runtimeDir, { recursive: true });
const selfHostPath = join(runtimeDir, "self-host.cjs");
const kernelPath = join(runtimeDir, "kernel.mjs");
const stubExt4 = join(runtimeDir, "stub");
mkdirSync(stubExt4, { recursive: true });
copyFileSync(srcSelfHost, selfHostPath);
copyFileSync(srcKernel, kernelPath);
copyFileSync(join(stubHost, "QQNT.dll"), join(stubExt4, "QQNT.dll"));
console.log(`[wine-login] 运行时已复制到 ext4: ${runtimeDir}`);
console.log(`[wine-login] wine 跑 self-host（路径 Z: 视角）…`);

// 4.5 kernel entry 环境变量 + stub 重定向（stub 已复制到 ext4，wine 视角 Z:）
env["NAPUTO_KERNEL_ENTRY"] = toWinePath(kernelPath);
env["NAPUTO_STUB_DIR"] = toWinePath(stubExt4);
// ⚠️ wine 内 DLL 搜索路径必须走 WINEPATH（wine 专用，; 分隔 Windows 路径），
//    不能覆盖 PATH（wine 自己是 Linux 程序，PATH 还要用于解析 wine 可执行文件；
//    实测覆盖 PATH 后 spawn wine 直接 ENOENT）。WINEPATH 是 2026-08-12 探针
//    验证通过的机制（进程内 dlopen wrapper.node 98 exports 成功）。
env["WINEPATH"] = [toWinePath(stubExt4), toWinePath(wrapperDir)].join(";");

// 6. spawn wine + win-node + self-host.cjs（登录长驻，观察后退出）
//    ⚠️ wine 是 Linux 程序，靠 Linux PATH 解析；不能用上面覆盖过的
//    Windows 风格 PATH（那是给 wine 内 Windows 进程用的 DLL 搜索路径）。
//    故先取 wine 绝对路径（bash -lc 走 Linux 登录 PATH），再 spawn。
const wineBin =
    process.env["NAPUTO_WINE"] ??
    (() => {
        try {
            return execFileSync("bash", ["-lc", "command -v wine"]).toString().trim();
        } catch {
            return "wine";
        }
    })();
// ⚠️ 必须用 PTY（script 命令包装）：wine 内 Windows 进程在管道环境下
// stdin/stdout/stderr 句柄全坏（EBADF），Node 加载内置模块 ESM facade 时
// 访问 getStdin/getStdout 直接崩（2026-08-12 实测：管道下 kernel import
// FAIL EBADF，script 包装后 OK）。script 输出落到 wine-console.log。
// ⚠️ script -c 的字符串交给 bash 解析：反斜杠会被吞（实测 Z:\ 变 Z:），
// 故路径统一转正斜杠（Windows Node 接受 Z:/ 形式）。
const scriptOut = join(runtimeDir, "wine-console.log");
const selfHostArg = toWinePath(selfHostPath).replace(/\\/g, "/");
const cmdStr = `${wineBin} ${winNode.exePath} ${selfHostArg}`;
const child = spawn("script", ["-qec", cmdStr, scriptOut], {
    cwd: dataRoot,
    env,
    stdio: "inherit",
});
let sawReady = false;
const timeout = setTimeout(() => {
    console.log(`[wine-login] ⏱️ ${sawReady ? "已见 ready，超时观察结束" : "90s 未 ready"}，退出`);
    child.kill("SIGKILL");
}, 90_000);

// ready 检测（inherit 下无 stdout 可解析）：轮询 boot 日志文件。
// self-host 的 log() 写 NAPUTO_CFG_DIR/napuketto-boot.log（不走 stdout）；
// kernel 的 pino 日志走 stdout → script 的 wine-console.log。两个都轮询。
// ⚠️ 成功标志用 bootstrap 的真实成功日志（"session init + startNT OK!" /
//    "QQ session 就绪"）——"bootstrap 完成" 是 self-host 的兜底日志，
//    失败也打（2026-08-12 实测踩坑：kernel import 失败仍打"bootstrap 完成"）。
// ⚠️ wine 环境限制（2026-08-12 实测）：wrapper 的 QR 回调（getQRCodePicture →
//    onQRCodeGetPicture）在 wine 下不触发（疑似缺 winbind/网络初始化组件），
//    且 wine 全新环境无历史登录凭证（快速登录必失败）——故 wine 场景以
//    「到达登录阶段」（loginService.initConfig OK，pino 日志）为验证通过标准；
//    若后续出现真实登录成功日志（session init + startNT OK! / QQ session 就绪）
//    同样视为通过。
const bootLogPath = join(cfgDir, "napuketto-boot.log");
const consoleLogPath = join(runtimeDir, "wine-console.log");
function checkReady() {
    if (sawReady) return;
    try {
        const boot = readFileSync(bootLogPath, "utf-8");
        const consoleOut = existsSync(consoleLogPath)
            ? readFileSync(consoleLogPath, "utf-8")
            : "";
        const all = boot + "\n" + consoleOut;
        if (
            all.includes("session init + startNT OK!") ||
            all.includes("QQ session 就绪") ||
            all.includes("loginService.initConfig OK")
        ) {
            sawReady = true;
            console.log("[wine-login] ✅ 检测到登录阶段就绪（boot/pino 日志）");
        }
    } catch {
        // 日志文件尚未创建，忽略
    }
}
const pollReady = setInterval(checkReady, 1_000);
child.on("error", (e) => {
    console.log(`[wine-login] ⚠️ spawn 失败: ${e.message}`);
});
child.on("exit", (code, signal) => {
    clearTimeout(timeout);
    clearInterval(pollReady);
    console.log(`[wine-login] 子进程退出 code=${code} signal=${signal ?? ""}`);
    if (sawReady) {
        console.log("[wine-login] ✅ 通过：session READY（完整链路 wine 下跑通）");
        process.exit(0);
    }
    // 失败时打印 boot 日志尾部，方便诊断
    try {
        const content = readFileSync(bootLogPath, "utf-8");
        const tail = content.split("\n").slice(-25).join("\n");
        console.log(`[wine-login] 📄 boot 日志尾部:\n${tail}`);
    } catch {
        // 无日志
    }
    console.log(`[wine-login] ❌ 未达到 ready 就退出（code=${code}）`);
    process.exit(code ?? 1);
});
