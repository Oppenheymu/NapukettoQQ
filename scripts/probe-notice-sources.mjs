#!/usr/bin/env node

// biome-ignore-all lint: 一次性探测脚本（诊断用，c3 2026-09-10 历史参考，不参与产品质量面）
/**
 * 探测驱动:notice 无源事件动态验证 + downloadRichMediaInVisit 参数试探（c3,2026-09-10）
 *
 * 用途:起 NAPUTO_IPC=1 自建宿主（本地构建,含 2026-09-10 新接线桥方法
 * onRecvOfflineFileMsg/onRecvOnlineFileMsg/onRecvSysMsg/onGroupEssenceListChange）,
 * 经 stdio JSON 行协议:
 *   1) 枚举 msgService/richMediaService 方法面（registerSysMsgNotification /
 *      getNewOfflineFileList / downloadRichMediaInVisit 存在性）
 *   2) 只读拉取 getNewOfflineFileList（离线文件实体形状——offline_file 翻译参考）
 *   3) 90s 事件观测窗:全通道事件计数 + 新候选通道首样本捕获
 *      （sys msg 是否经 listener 推送的关键判据）
 *   4) T4:getLatestDbMsgs 找真实 ptt/pic 元素 → downloadRichMediaInVisit
 *      参数变体试探（下载类调用:网络读 + 本地缓存写,允许实测）
 *
 * 护栏:不发消息不写群;仅只读拉取 + 媒体下载类调用;写类原生动作严禁调用。
 * 产物:$TEMP/napuketto-probe/notice-sources.json
 *
 * 用法:node scripts/probe-notice-sources.mjs
 * 前置:pnpm -r build;koishi-dev 实例已停（同账号互斥）;票据有效。
 */

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launchSelfHost, resolveQqInstall } from "../packages/loader/dist/index.mjs";

const REPO = resolve(import.meta.dirname, "..");
const OUT_DIR = join(tmpdir(), "napuketto-probe");
const ARTIFACTS = join(OUT_DIR, "notice-sources.json");
const UIN = "3567141148";
const DATA_ROOT = join(REPO, ".napuketto");
const CFG_DIR = join(DATA_ROOT, UIN);
/** 事件观测窗（毫秒）——登录后系统消息同步期覆盖。 */
const WATCH_MS = 90_000;
/** 每通道保留样本数 / 单样本截断长度。 */
const SAMPLE_MAX = 3;
const SAMPLE_CLIP = 1200;

const out = { startedAt: new Date().toISOString(), steps: [] };
function save() {
    writeFileSync(ARTIFACTS, JSON.stringify(out, null, 2));
}
function step(name, data) {
    out.steps.push({ name, at: new Date().toISOString(), data });
    save();
    console.log(`[step] ${name}: ${JSON.stringify(data).slice(0, 400)}`);
}

// ── stdout JSON 行提取（与 probe-download-richmedia 同款:{"v":1 起点 + 花括号深度） ──
function makeLineParser(handle) {
    let buf = "";
    return (chunk) => {
        buf += chunk;
        for (;;) {
            const idx = buf.indexOf('{"v":1');
            if (idx === -1) {
                if (buf.length > 200_000) {
                    buf = buf.slice(-4096);
                }
                return;
            }
            if (idx > 0) {
                buf = buf.slice(idx);
            }
            let depth = 0;
            let end = -1;
            let inStr = false;
            let esc = false;
            for (let i = 0; i < buf.length; i++) {
                const c = buf[i];
                if (esc) {
                    esc = false;
                    continue;
                }
                if (c === "\\") {
                    esc = true;
                    continue;
                }
                if (c === '"') {
                    inStr = !inStr;
                    continue;
                }
                if (inStr) {
                    continue;
                }
                if (c === "{") {
                    depth++;
                } else if (c === "}") {
                    depth--;
                    if (depth === 0) {
                        end = i;
                        break;
                    }
                }
            }
            if (end === -1) {
                return;
            }
            const line = buf.slice(0, end + 1);
            buf = buf.slice(end + 1);
            try {
                handle(JSON.parse(line));
            } catch {
                // 忽略解析失败
            }
        }
    };
}

// ── 事件计数（全通道,新候选通道留样本） ──
const CANDIDATES = new Set([
    "Msg/onRecvOfflineFileMsg",
    "Msg/onRecvOnlineFileMsg",
    "Msg/onRecvSysMsg",
    "Group/onGroupEssenceListChange",
]);
const tally = new Map(); // key -> { count, samples: string[] }
function onEvent(payload) {
    const key = `${payload.service}/${payload.name}`;
    let e = tally.get(key);
    if (e === undefined) {
        e = { count: 0, samples: [] };
        tally.set(key, e);
    }
    e.count++;
    if (e.samples.length < SAMPLE_MAX) {
        e.samples.push(JSON.stringify(payload.args ?? null).slice(0, SAMPLE_CLIP));
    }
    if (CANDIDATES.has(key)) {
        console.log(
            `[event!] ${key} #${e.count}: ${e.samples[e.samples.length - 1].slice(0, 200)}`,
        );
    }
}

// ── action 往返 ──
const pending = new Map();
let nextId = 1;
function sendAction(child, action, params = {}) {
    const id = nextId++;
    return new Promise((res, rej) => {
        pending.set(id, { res, rej, action });
        child.stdin.write(
            `${JSON.stringify({ v: 1, type: "action", id, payload: { action, params } })}\n`,
        );
        setTimeout(() => {
            if (pending.has(id)) {
                pending.delete(id);
                rej(new Error(`action 超时: ${action}`));
            }
        }, 45_000).unref();
    });
}

async function main() {
    mkdirSync(OUT_DIR, { recursive: true });
    const t10toml = join(tmpdir(), "napuketto-t10", "napuketto.toml");
    const cfgFile = join(OUT_DIR, "napuketto.toml");
    if (existsSync(t10toml)) {
        copyFileSync(t10toml, cfgFile);
    } else {
        copyFileSync(join(REPO, "napuketto.toml"), cfgFile);
    }
    step("tmp-config", { cfgFile });

    const qq = resolveQqInstall();
    step("qq-install", { qqPath: qq.qqPath, version: qq.version });

    const { child } = await launchSelfHost({
        qq,
        kernelEntry: join(REPO, "packages/kernel/dist/index.mjs"),
        adapterEntry: join(REPO, "packages/adapter/dist/index.mjs"),
        networkEntry: join(REPO, "packages/network/dist/index.mjs"),
        cfgDir: CFG_DIR,
        cwd: DATA_ROOT,
        configPath: cfgFile,
        selfHost: true,
        ipc: true,
        quickUin: UIN,
        stdio: ["pipe", "pipe", "pipe"],
    });
    step("spawned", { pid: child.pid });

    let phase = "";
    let pendingReady = null;
    const ready = new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error(`宿主引导超时,最后阶段: ${phase}`)), 150_000);
        child.on("exit", (code) => {
            clearTimeout(to);
            rej(new Error(`宿主提前退出 code=${code}`));
        });
        pendingReady = { res, to };
    });

    child.stdout.on(
        "data",
        makeLineParser((msg) => {
            if (msg.type === "status") {
                phase = msg.payload.phase;
                console.log(`[status] ${phase} ${msg.payload.message ?? ""}`);
                if (phase === "ready" && pendingReady !== null) {
                    clearTimeout(pendingReady.to);
                    pendingReady.res();
                    pendingReady = null;
                }
                if (phase === "failed") {
                    console.error(`[failed] ${JSON.stringify(msg.payload.error)}`);
                }
                return;
            }
            if (msg.type === "result") {
                const p = pending.get(msg.id);
                if (p !== undefined) {
                    pending.delete(msg.id);
                    p.res(msg.payload);
                }
                return;
            }
            if (msg.type === "event") {
                onEvent(msg.payload);
            }
        }),
    );
    child.stderr.on("data", (c) => {
        const s = String(c);
        if (!s.includes("MMKV") && s.trim() !== "") {
            console.error(`[stderr] ${s.slice(0, 300)}`);
        }
    });

    await ready;
    step("ready", { phase });

    // 1) 方法面:关注 sysmsg / offline file / InVisit 存在性
    const msgMethods = await sendAction(child, "diag.msgServiceCall", { method: "__methods" });
    const methods = msgMethods?.value?.methods ?? [];
    const msgWatch = [
        "registerSysMsgNotification",
        "unregisterSysMsgNotification",
        "getNewOfflineFileList",
        "addNewOfflineFileList",
        "getMsgEmojiLikesList",
        "setMsgEmojiLikes",
        "downloadRichMedia",
    ].filter((m) => methods.includes(m));
    step("msgService-methods-watchlist", { present: msgWatch, total: methods.length });
    const rmMethods = await sendAction(child, "diag.richMediaCall", { method: "__methods" });
    step("richMedia-invisit-present", {
        hasDownloadRichMediaInVisit: (rmMethods?.value?.methods ?? []).includes(
            "downloadRichMediaInVisit",
        ),
    });

    // 2) 离线文件实体形状（只读拉取;失败形状也是证据）
    const off1 = await sendAction(child, "diag.msgServiceCall", {
        method: "getNewOfflineFileList",
        args: [{}],
    });
    step("getNewOfflineFileList-arg-obj", truncate(off1, 4000));
    if (off1?.value?.ok !== true) {
        const off2 = await sendAction(child, "diag.msgServiceCall", {
            method: "getNewOfflineFileList",
            args: [10],
        });
        step("getNewOfflineFileList-arg-num", truncate(off2, 4000));
    }

    // 3) T4:找真实富媒体元素 → downloadRichMediaInVisit 参数变体
    const groups = await sendAction(child, "get_group_list", {});
    const gid = groups?.value?.data?.[0]?.group_id ?? groups?.value?.data?.data?.[0]?.group_id;
    step("first-group", { gid });
    let target = null;
    let richListCache = null;
    if (gid !== undefined && methods.includes("getLatestDbMsgs")) {
        const r = await sendAction(child, "diag.msgServiceCall", {
            method: "getLatestDbMsgs",
            args: [{ chatType: 2, peerUid: String(gid) }, 100],
        });
        richListCache = r?.value?.ret ?? null;
        target = findRichElement(richListCache);
        step(
            "rich-element-target",
            target === null
                ? { found: false }
                : {
                      found: true,
                      msgId: target.msgId,
                      elemId: target.elemId,
                      elementType: target.elementType,
                      kind: target.kind,
                      filePath: target.filePath,
                  },
        );
    }
    if (target !== null) {
        const base = {
            msgId: target.msgId,
            elemId: target.elemId,
            chatType: 2,
            downloadType: 2,
            thumbSize: 0,
        };
        // elem 对象（第一轮实测四变体全 "Cannot convert undefined or null to object";
        // 静态证据 GetVideoPlayUrlInVisit "elem = null" 提示 InVisit 族收 elem 元素对象）
        const elemObj = findRichElement(richListCache)?.element ?? null;
        const variants = [
            { label: "base", param: base },
            {
                label: "plus-elemType-triggerType",
                param: { ...base, elemType: target.elementType, triggerType: 1 },
            },
            { label: "plus-peerUid", param: { ...base, peerUid: String(gid) } },
            {
                label: "plus-all",
                param: {
                    ...base,
                    elemType: target.elementType,
                    triggerType: 1,
                    peerUid: String(gid),
                },
            },
        ];
        if (elemObj !== null) {
            variants.push(
                { label: "with-elem-full", param: { ...base, elem: elemObj } },
                {
                    label: "with-elem-media",
                    param: {
                        ...base,
                        elem: elemObj[target.kind === "ptt" ? "pttElement" : "picElement"],
                    },
                },
            );
        }
        for (const v of variants) {
            const r = await sendAction(child, "diag.richMediaCall", {
                method: "downloadRichMediaInVisit",
                args: [v.param],
            });
            step(`invisit-${v.label}`, { param: clipParam(v.param), ret: truncate(r, 2500) });
            await sleep(2000);
        }
    }

    // 4) 事件观测窗:全通道计数 + 候选通道样本
    console.log(`[watch] 观测 ${WATCH_MS / 1000}s …`);
    const started = Date.now();
    while (Date.now() - started < WATCH_MS) {
        await sleep(15_000);
        console.log(
            `[watch] +${Math.round((Date.now() - started) / 1000)}s 通道数=${tally.size} ` +
                [...tally.entries()]
                    .map(([k, e]) => `${k}×${e.count}`)
                    .join(" ")
                    .slice(0, 600),
        );
    }
    step("event-tally", {
        channels: Object.fromEntries([...tally.entries()].map(([k, e]) => [k, e.count])),
        candidateSamples: Object.fromEntries(
            [...tally.entries()].filter(([k]) => CANDIDATES.has(k)).map(([k, e]) => [k, e.samples]),
        ),
    });

    // 5) 收尾
    child.stdin.write(
        `${JSON.stringify({ v: 1, type: "control", payload: { command: "stop" } })}\n`,
    );
    await sleep(3000);
    killTree(child.pid);
    process.exit(0);
}

/** 从 msgList 提取首个 ptt/pic 元素（含 msgId/elemId/elementType 上下文与完整元素,只读）。 */
function findRichElement(payload) {
    const msgs = Array.isArray(payload) ? payload : payload?.msgList;
    if (!Array.isArray(msgs)) {
        return null;
    }
    for (const msg of msgs) {
        for (const el of msg?.elements ?? []) {
            if (el?.pttElement !== null && typeof el?.pttElement === "object") {
                return {
                    msgId: msg.msgId,
                    elemId: el.elementId,
                    elementType: el.elementType,
                    kind: "ptt",
                    filePath: el.pttElement.filePath,
                    element: el,
                };
            }
            if (el?.picElement !== null && typeof el?.picElement === "object") {
                return {
                    msgId: msg.msgId,
                    elemId: el.elementId,
                    elementType: el.elementType,
                    kind: "pic",
                    filePath: el.picElement.sourcePath,
                    element: el,
                };
            }
        }
    }
    return null;
}

/** InVisit 参数落日志用裁剪（elem 对象只留键名,避免产物膨胀）。 */
function clipParam(param) {
    const clone = { ...param };
    if (clone.elem !== null && typeof clone.elem === "object") {
        clone.elem = { __keys: Object.keys(clone.elem) };
    }
    return clone;
}

function truncate(v, n = 1500) {
    const s = JSON.stringify(v, (k, val) => (typeof val === "bigint" ? String(val) : val));
    return s !== undefined && s.length > n ? `${s.slice(0, n)}…(截断)` : JSON.parse(s ?? "null");
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function killTree(pid) {
    if (pid === undefined) {
        return;
    }
    try {
        spawn("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
    } catch {
        // best-effort
    }
}

main().catch((err) => {
    console.error(`[fatal] ${err?.stack ?? err}`);
    step("fatal", { error: String(err) });
    process.exit(1);
});
