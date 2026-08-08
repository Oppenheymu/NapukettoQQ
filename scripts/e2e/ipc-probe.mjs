/**
 * ipc-probe.mjs：端到端联调探测脚本（开发态工具，不入库发布逻辑）。
 *
 * 直接 spawn launchSelfHost({ ipc: true }) 拉起自建宿主子进程，验证引导链路：
 * booting → dlopening → logging（登录）→ sessioning → ready。
 * - 关键状态（status/login/qr/result/failed）打 stdout
 * - 事件/日志只计数（防刷屏），全量写 probe.log
 * - QR 阶段 pngBase64 落盘 qr.png 供扫码
 *
 * 用法：node scripts/e2e/ipc-probe.mjs [uin]
 *   uin 缺省 3567141148（HANDOVER 记录的无风控测试账号，本机有票据）。
 */
import { createInterface } from "node:readline";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfigPath, resolveDataRoot } from "../../packages/kernel/dist/index.mjs";
import {
    defaultStubDir,
    launchSelfHost,
    resolveQqInstall,
} from "../../packages/loader/dist/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROBE_UIN = process.argv[2] ?? "3567141148";
const QR_FILE = join(__dirname, "qr.png");
const LOG_FILE = join(__dirname, "probe.log");
const IPC_VERSION = 1;

// 与 koishi 插件 launch.ts resolveLaunchOptions 对齐的组装
const dataRoot = resolveDataRoot();
const qq = resolveQqInstall();
const repoRoot = join(__dirname, "..", "..");
const options = {
    qq,
    kernelEntry: join(repoRoot, "packages", "kernel", "dist", "index.mjs"),
    cfgDir: join(dataRoot, PROBE_UIN),
    cwd: dataRoot,
    configPath: resolveConfigPath({ dataRoot }),
    stubDir: defaultStubDir(),
    quickUin: PROBE_UIN,
    selfHost: true,
    ipc: true,
    stdio: ["pipe", "pipe", "pipe"],
};

console.log(`[probe] uin=${PROBE_UIN}`);
console.log(`[probe] qq=${qq.qqPath} version=${qq.version}`);
console.log(`[probe] kernelEntry=${options.kernelEntry}`);
console.log(`[probe] dataRoot=${dataRoot} cfgDir=${options.cfgDir}`);

const { child } = launchSelfHost(options);
mkdirSync(__dirname, { recursive: true });
const logStream = createWriteStream(LOG_FILE, { flags: "a" });

let qrCount = 0;
let eventCount = 0;
let msgEventCount = 0;
let loggedIn = false;
let ready = false;
let failed = false;
let nextId = 1000;
const pending = new Map();

/** 发 action 请求（stdin），等 result。 */
function sendAction(action, params) {
    const id = nextId++;
    const p = new Promise((resolve) => {
        pending.set(id, resolve);
    });
    child.stdin.write(`${JSON.stringify({ v: IPC_VERSION, type: "action", id, payload: { action, params } })}\n`);
    return p;
}

const onLine = (raw) => {
    if (raw.trim() === "") {
        return;
    }
    logStream.write(`[stdout] ${raw}\n`);
    let msg = null;
    try {
        msg = JSON.parse(raw);
    } catch {
        return; // pino 日志等非协议行，仅落盘
    }
    const type = msg.type ?? "?";
    if (type === "qr") {
        qrCount += 1;
        const p = msg.payload ?? {};
        if (p?.pngBase64) {
            writeFileSync(QR_FILE, Buffer.from(p.pngBase64, "base64"));
            console.log(`[probe][qr #${qrCount}] → ${QR_FILE}`);
        }
        console.log(`[probe] ⚠️ 请用 QQ 扫描 ${QR_FILE}（${p?.qrcodeUrl ?? ""}）`);
        return;
    }
    if (type === "event") {
        eventCount += 1;
        const p = msg.payload ?? {};
        if (p?.service === "Msg" && p?.name === "onRecvMsg") {
            msgEventCount += 1;
        }
        return;
    }
    if (type === "result") {
        const p = msg.payload ?? {};
        console.log(`[probe][result] id=${msg.id ?? "?"} ok=${p?.ok}`);
        if (p?.ok === true) {
            console.log(`[probe][result 值] ${JSON.stringify(p?.value)?.slice(0, 300)}`);
        } else {
            console.log(`[probe][result 错误] ${JSON.stringify(p?.error)}`);
        }
        const resolve = pending.get(msg.id);
        if (typeof resolve === "function") {
            pending.delete(msg.id);
            resolve(p);
        }
        return;
    }
    if (type === "ping" || type === "pong" || type === "log") {
        return;
    }
    console.log(`[probe][${type}] ${JSON.stringify(msg.payload)}`);
    if (type === "login") {
        const p = msg.payload ?? {};
        if (p?.state === "logged_in") {
            loggedIn = true;
            console.log(`[probe] ✅ 登录成功 uin=${p?.selfInfo?.uin ?? "?"}`);
        }
        if (p?.state === "waiting_scan") {
            console.log("[probe] ⏳ 等待扫码…");
        }
    }
    if (type === "status") {
        const p = msg.payload ?? {};
        if (p?.phase === "ready") {
            ready = true;
            console.log("[probe] ✅ session READY，链路全通");
            console.log(`[probe] 📊 事件总计=${eventCount}（Msg/onRecvMsg=${msgEventCount}）`);
            void runActionTests();
        }
        if (p?.phase === "failed") {
            failed = true;
            console.log(`[probe] ❌ 引导失败: ${p?.error?.message ?? "?"}`);
        }
    }
};

const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
rl.on("line", onLine);
child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    logStream.write(`[stderr] ${text}\n`);
    for (const line of text.split("\n")) {
        const t = line.trim();
        if (t === "") {
            continue;
        }
        // 过滤 wrapper 原生噪音，其余转发
        if (/MMKV|SharedPreferences|mangled|symbol/i.test(t)) {
            continue;
        }
        console.log(`[probe][stderr] ${t}`);
    }
});

child.once("exit", (code) => {
    console.log(`[probe] 子进程退出 code=${code}`);
    logStream.end();
    process.exit(0);
});

// 心跳观测：5s 无关键输出 → 提示卡住（原生层挂起）
let lastKey = Date.now();
const watch = setInterval(() => {
    if (ready || failed) {
        return;
    }
    const now = Date.now();
    if (now - lastKey > 5000) {
        console.log(`[probe] ⚠️ ${(now - lastKey) / 1000}s 无关键输出（可能卡在原生层）`);
    }
}, 5000);
rl.on("line", (raw) => {
    try {
        const msg = JSON.parse(raw);
        if (msg.type === "status" || msg.type === "login" || msg.type === "qr") {
            lastKey = Date.now();
        }
    } catch {
        // 非协议行不计
    }
});
process.on("SIGINT", () => {
    clearInterval(watch);
    console.log("[probe] 用户中断，kill 子进程");
    child.kill();
    logStream.end();
    process.exit(0);
});

/** ready 后动作链路测试（与 koishi 插件动作桥同构）。 */
async function runActionTests() {
    try {
        const self = await sendAction("login.getSelf", undefined);
        console.log(`[probe][test getSelf] ok=${self?.ok}`);
        const groups = await sendAction("group.getGroupList", undefined);
        const list = groups?.ok === true ? (groups.value ?? []) : [];
        console.log(`[probe][test getGroupList] ok=${groups?.ok} 群数=${Array.isArray(list) ? list.length : "?"}`);
        console.log("[probe] ✅ 动作链路测试完成（可 Ctrl+C 退出）");
    } catch (e) {
        console.log(`[probe][test] 动作异常: ${e?.message ?? String(e)}`);
    }
}
