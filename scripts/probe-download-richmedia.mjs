#!/usr/bin/env node

// biome-ignore-all lint: 一次性探测脚本（诊断用，T10 B1 历史参考，不参与产品质量面）
/**
 * 探测驱动:downloadRichMedia 原生签名(B1,2026-09-08)
 *
 * 用途:起 NAPUTO_IPC=1 自建宿主(stdio JSON 行协议),经 diag.* 动作:
 *   1) 枚举 getRichMediaService / getMsgService 方法面(__methods)
 *   2) 拉测试群最近消息找真实 pttElement(只读);找不到则发一条测试语音
 *      (发送链路 2026-08-12 已实证)从 Msg/onRecvMsg 事件抓全字段
 *   3) 用真实字段试调 downloadRichMedia(MsgService)/ downloadRichMediaInVisit
 *      (RichMediaService)——下载类(网络读 + 本地缓存写),允许实测
 *
 * 护栏:仅探测下载链路;写类原生动作(kick/rename/createFolder/delete 等)严禁调用。
 * 产物:$TEMP/napuketto-probe/artifacts.json(方法面 / ptt 全字段 / 各次调用返回)
 *
 * 用法:node scripts/probe-download-richmedia.mjs [--no-send](--no-send = 不发测试语音)
 * 前置:pnpm -r build;QQ 已安装(注册表定位);账号 3567141148 快速登录票据有效。
 */

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launchSelfHost, resolveQqInstall } from "../packages/loader/dist/index.mjs";

const REPO = resolve(import.meta.dirname, "..");
const OUT_DIR = join(tmpdir(), "napuketto-probe");
const ARTIFACTS = join(OUT_DIR, "artifacts.json");
const UIN = "3567141148";
const DATA_ROOT = join(REPO, ".napuketto");
const CFG_DIR = join(DATA_ROOT, UIN);
const NO_SEND = process.argv.includes("--no-send");

/** 探测产物(逐段落盘)。 */
const out = { startedAt: new Date().toISOString(), steps: [] };
function save() {
    writeFileSync(ARTIFACTS, JSON.stringify(out, null, 2));
}
function step(name, data) {
    out.steps.push({ name, at: new Date().toISOString(), data });
    save();
    console.log(`[step] ${name}: ${JSON.stringify(data).slice(0, 400)}`);
}

// ── stdout JSON 行提取(QQ 原生日志无 \n 会粘行:按 {"v":1 起点 + 花括号深度) ──
function makeLineParser(handle) {
    let buf = "";
    return (chunk) => {
        buf += chunk;
        for (;;) {
            const idx = buf.indexOf('{"v":1');
            if (idx === -1) {
                // 无协议行:保留尾部少量噪声日志,丢弃超长积压
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
                return; // 不完整,等下一段
            }
            const line = buf.slice(0, end + 1);
            buf = buf.slice(end + 1);
            try {
                handle(JSON.parse(line));
            } catch {
                // 忽略解析失败(理论不会)
            }
        }
    };
}

// ── action 往返 + 事件收集 ──
const pending = new Map();
let nextId = 1;
/** 最近收到的群/私聊消息事件(Msg/onRecvMsg args[0] = RawMessage[])。 */
const recvQueue = [];

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
    // 临时配置(不动用户 napuketto.toml):优先复用 t10 临时配置,否则从仓库根复制
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
                if (phase === "ready" && pendingReady) {
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
            if (
                msg.type === "event" &&
                msg.payload.service === "Msg" &&
                msg.payload.name === "onRecvMsg"
            ) {
                recvQueue.push(msg.payload.args?.[0]);
                if (recvQueue.length > 100) {
                    recvQueue.shift();
                }
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

    // 1) 方法面
    const msgMethods = await sendAction(child, "diag.msgServiceCall", { method: "__methods" });
    step("msgService-methods", msgMethods);
    const rmMethods = await sendAction(child, "diag.richMediaCall", { method: "__methods" });
    step("richMedia-methods", rmMethods);

    // 2) 测试群 + 历史消息找 ptt
    const groups = await sendAction(child, "get_group_list", {});
    const gid = groups?.value?.data?.[0]?.group_id ?? groups?.value?.data?.data?.[0]?.group_id;
    step("first-group", { gid });
    if (gid === undefined) {
        throw new Error("get_group_list 无群");
    }

    const methods = msgMethods?.value?.methods ?? [];
    let pttList = [];
    const scanPeers = [{ chatType: 2, peerUid: String(gid) }];
    // 扫描其他群历史,找本地未命中的语音(真实下载场景;只读)
    if (methods.includes("getLatestDbMsgs")) {
        const more = await sendAction(child, "get_group_list", {});
        const all = more?.value?.data?.data ?? more?.value?.data ?? [];
        for (const g of all.slice(0, 8)) {
            scanPeers.push({ chatType: 2, peerUid: String(g.group_id) });
        }
    }
    for (const peer of scanPeers) {
        if (!methods.includes("getLatestDbMsgs")) {
            break;
        }
        const r = await sendAction(child, "diag.msgServiceCall", {
            method: "getLatestDbMsgs",
            args: [peer, 100],
        });
        const list = extractPttList(r?.value?.ret);
        for (const item of list) {
            pttList.push({ ...item, peer });
        }
    }
    step("history-ptt-list", {
        total: pttList.length,
        items: pttList.slice(0, 12).map((p) => ({
            peer: p.peer.peerUid,
            msgId: p.msgId,
            elemId: p.elemId,
            fileName: p.ptt.fileName,
            filePath: p.ptt.filePath,
            transferStatus: p.ptt.transferStatus,
            localExists: p.ptt.filePath !== undefined && existsSync(p.ptt.filePath),
        })),
    });
    // 优先本地未命中的语音(真实下载场景);全命中则取第一条验证签名
    let target = pttList.find((p) => p.ptt.filePath !== undefined && !existsSync(p.ptt.filePath));
    if (target === undefined) {
        target = pttList.find((p) => (p.ptt.transferStatus ?? 0) !== 4);
    }
    if (target === undefined) {
        target = pttList[0];
    }
    let ptt = target ?? null;

    // 无历史 ptt → 发一条测试语音,从 onRecvMsg 抓全字段
    if (ptt === null && !NO_SEND) {
        const wav = makeTinyWav(join(OUT_DIR, "probe-tts.wav"));
        const sent = await sendAction(child, "send_group_msg", {
            group_id: Number(gid),
            message: [{ type: "record", data: { file: wav } }],
        });
        step("send-record", truncate(sent));
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline && ptt === null) {
            await sleep(500);
            for (const msgs of [...recvQueue]) {
                const list = extractPttList(msgs);
                if (list.length > 0) {
                    ptt = list[0];
                    step("ptt-from-recv", { msgId: ptt.msgId, ptt: truncate(ptt.ptt, 3000) });
                    break;
                }
            }
        }
    }
    if (ptt === null) {
        step("no-ptt", { note: "历史与发送路径均未取得 pttElement" });
    }

    // 4) 试调 downloadRichMedia(单参数对象,字段按二进制日志证据 + 变体)
    if (ptt !== null) {
        const { msgId, elemId, chatType, peer } = ptt;
        step("ptt-target-full", {
            msgId,
            elemId,
            chatType,
            peerUid: peer.peerUid,
            ptt: truncate(ptt.ptt, 4000),
            localExists: ptt.ptt.filePath !== undefined && existsSync(ptt.ptt.filePath),
        });
        // 本地命中且 FORCE_RENAME:临时挪走文件验证真下载(结束恢复;数据目录可逆操作)
        let renamedFrom = null;
        const targetPath = ptt.ptt.filePath;
        if (
            process.env.FORCE_RENAME === "1" &&
            targetPath !== undefined &&
            existsSync(targetPath)
        ) {
            renamedFrom = `${targetPath}.probe-bak`;
            renameSync(targetPath, renamedFrom);
            step("renamed-away", { targetPath, renamedFrom });
        }
        const base = {
            msgId,
            elemId,
            chatType,
            downloadType: 2,
            thumbSize: 0,
        };
        const variants = [
            {
                where: "msg.downloadRichMedia",
                action: "diag.msgServiceCall",
                method: "downloadRichMedia",
                param: base,
            },
        ];
        for (const v of variants) {
            const r = await sendAction(child, v.action, { method: v.method, args: [v.param] });
            step(`try-${v.where}`, { param: v.param, ret: truncate(r, 4000) });
        }
        // void 返回场景:轮询重拉该消息(300ms × 40),观察 transferStatus/filePath 演化
        const observations = [];
        for (let i = 0; i < 40; i++) {
            await sleep(300);
            const again = await sendAction(child, "diag.msgServiceCall", {
                method: "getMsgsByMsgId",
                args: [{ chatType, peerUid: peer.peerUid }, [msgId]],
            });
            const after = extractPttList(again?.value?.ret);
            const p = after[0]?.ptt;
            observations.push({
                t: i,
                transferStatus: p?.transferStatus,
                progress: p?.progress,
                filePath: p?.filePath,
                localExists: p?.filePath !== undefined && existsSync(p.filePath),
            });
            const last = observations[observations.length - 1];
            if (last.localExists && i > 2) {
                break;
            }
        }
        step("download-observations", { observations });
        // 恢复:下载未还原文件时把备份改回
        if (renamedFrom !== null) {
            const targetFile = ptt.ptt.filePath;
            if (!existsSync(targetFile) && existsSync(renamedFrom)) {
                renameSync(renamedFrom, targetFile);
                step("restored-backup", { targetFile });
            } else if (existsSync(renamedFrom)) {
                rmSync(renamedFrom);
                step("download-restored-file-bak-removed", { targetFile });
            }
        }
    }

    // 5) 收尾:control stop
    child.stdin.write(
        `${JSON.stringify({ v: 1, type: "control", payload: { command: "stop" } })}\n`,
    );
    await sleep(3000);
    killTree(child.pid);
    process.exit(0);
}

/** 从 msgList(RawMessage[])或 {result, msgList} 提取全部 ptt(带消息/元素上下文)。 */
function extractPttList(payload) {
    const msgs = Array.isArray(payload) ? payload : payload?.msgList;
    if (!Array.isArray(msgs)) {
        return [];
    }
    const found = [];
    for (const msg of msgs) {
        for (const el of msg?.elements ?? []) {
            if (el?.pttElement !== null && typeof el?.pttElement === "object") {
                found.push({
                    msgId: msg.msgId,
                    elemId: el.elementId,
                    chatType: msg.chatType,
                    peerUid: msg.peerUid,
                    msgTime: msg.msgTime,
                    ptt: el.pttElement,
                });
            }
        }
    }
    return found;
}

/** 最小 wav(8000Hz 16bit mono,1.2s 440Hz)——发送链路内部自动转码(2026-08-12 实证)。 */
function makeTinyWav(path) {
    const rate = 8000;
    const seconds = 1.2;
    const samples = Math.floor(rate * seconds);
    const dataSize = samples * 2;
    const buf = Buffer.alloc(44 + dataSize);
    buf.write("RIFF", 0);
    buf.writeUInt32LE(36 + dataSize, 4);
    buf.write("WAVE", 8);
    buf.write("fmt ", 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(rate, 24);
    buf.writeUInt32LE(rate * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write("data", 36);
    buf.writeUInt32LE(dataSize, 40);
    for (let i = 0; i < samples; i++) {
        const v = Math.floor(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000);
        buf.writeInt16LE(v, 44 + i * 2);
    }
    writeFileSync(path, buf);
    return path;
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
