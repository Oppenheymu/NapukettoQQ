/**
 * bundle-probe.mjs：验证 koishi 插件 bundle 产物（lib/index.cjs）的 IPC 链路。
 *
 * 背景（2026-08-08 联调）：koishi 加载 lib/index.cjs 后 action 超时，而主仓库
 * dist 直测正常——怀疑 bundle 逻辑差异。本脚本用 bundle 导出的 buildLaunch
 * spawn 子进程，手动 stdin/stdout 通信测试 action。
 *
 * 用法：node scripts/e2e/bundle-probe.mjs [uin]
 */
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repoRoot = join(__dirname, "..", "..");
const bundle = require(join(
    repoRoot,
    "apps",
    "koishi-plugin-adapter",
    "lib",
    "index.cjs",
));

const PROBE_UIN = process.argv[2] ?? "3567141148";
const dataDir = join(repoRoot, ".napuketto");
const config = {
    selfId: PROBE_UIN,
    kernelEntry: join(repoRoot, "packages", "kernel", "dist", "index.mjs"),
    selfHostEntry: join(repoRoot, "packages", "loader", "dist", "host", "self-host.cjs"),
    stubDir: join(repoRoot, "packages", "loader", "native", "build", "stub-test-env"),
    dataDir,
};

console.log(`[bundle-probe] uin=${PROBE_UIN}`);
console.log(`[bundle-probe] buildLaunch=${typeof bundle.buildLaunch}`);
console.log(`[bundle-probe] resolveLaunchOptions=${typeof bundle.resolveLaunchOptions}`);

const launch = bundle.buildLaunch(config);
const { child } = launch();
console.log(`[bundle-probe] child pid=${child.pid}`);

const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
let nextId = 1;
const pending = new Map();
let ready = false;

rl.on("line", (raw) => {
    let msg = null;
    try {
        msg = JSON.parse(raw);
    } catch {
        return;
    }
    const type = msg.type ?? "?";
    if (type === "status") {
        const phase = msg.payload?.phase;
        console.log(`[bundle-probe][status] ${phase}`);
        if (phase === "ready") {
            ready = true;
            console.log("[bundle-probe] ✅ ready，发 getSelf action…");
            sendAction("login.getSelf");
        }
        if (phase === "failed") {
            console.log(`[bundle-probe] ❌ failed: ${msg.payload?.error?.message}`);
        }
    } else if (type === "result") {
        console.log(`[bundle-probe][result] id=${msg.id} ok=${msg.payload?.ok}`);
        if (msg.payload?.ok === true) {
            console.log(`[bundle-probe][result 值] ${JSON.stringify(msg.payload?.value)?.slice(0, 200)}`);
        } else {
            console.log(`[bundle-probe][result 错误] ${JSON.stringify(msg.payload?.error)}`);
        }
        const resolve = pending.get(msg.id);
        if (resolve) {
            pending.delete(msg.id);
            resolve();
        }
    } else if (type === "qr") {
        console.log("[bundle-probe][qr] 等待扫码（png 未落盘，本验证聚焦 action）");
    } else if (type === "login") {
        console.log(`[bundle-probe][login] ${msg.payload?.state}`);
    } else if (type === "event") {
        console.log(`[bundle-probe][event] ${msg.payload?.service}/${msg.payload?.name}`);
    } else if (type === "ping" || type === "pong") {
        // 心跳静默
    }
});

child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    for (const line of text.split("\n")) {
        const t = line.trim();
        if (t === "" || /MMKV|SharedPreferences|mangled/i.test(t)) {
            continue;
        }
        console.log(`[bundle-probe][stderr] ${t}`);
    }
});

function sendAction(action, params) {
    const id = nextId++;
    const p = new Promise((resolve) => {
        pending.set(id, resolve);
    });
    child.stdin.write(
        `${JSON.stringify({ v: 1, type: "action", id, payload: { action, params } })}\n`,
    );
    return p;
}

child.once("exit", (code) => {
    console.log(`[bundle-probe] 子进程退出 code=${code}`);
    process.exit(0);
});

setTimeout(() => {
    console.log("[bundle-probe] ⚠️ 60s 无 ready/result，诊断结束");
    child.kill();
    process.exit(1);
}, 90_000);
