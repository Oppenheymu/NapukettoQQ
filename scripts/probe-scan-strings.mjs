#!/usr/bin/env node

// biome-ignore-all lint: 一次性探测脚本（诊断用，不参与产品质量面）
/**
 * wrapper.node 二进制字符串扫描（2026-09-10，授权协议兼容性逆向：接口字符串事实，非 RVA/偏移）
 *
 * 用途：只读扫描 QQNT wrapper.node，流式提取 ASCII / UTF-16LE 可打印字符串（≥4 字符），
 *   产出事件回调候选证据，供 kernel 事件桥接线决策（notice 无源事件）：
 *   a) 全量 on[A-Z]\w+ 回调名（ASCII + UTF-16LE 双通道，按前缀分组，标记已接线 known）
 *   b) addKernel\w+Listener 注册方法名 + NodeIKernel\w+Service 服务接口名（候选挂载点判定）
 *   c) 五事件语义关键词命中（card/sign/emojiLike/emoji_like/title/offlineFile/offline_file/
 *      notify/top/essence/honor/lucky，另附 poke/nudge/typing/inputStatus 加分项），
 *      每命中带邻近字符串上下文（±10）与「信号/噪音」启发式初判
 *   d) downloadRichMedia(InVisit) 每个出现点 ±30 邻近字符串（T4 参数面证据，
 *      寻找 msgId/elemId/chatType/downloadType/thumbSize 等参数名与 needs N arguments 断言）
 *
 * 护栏：纯 existsSync + 只读 readSync 流式扫描，绝不加载模块、绝不写二进制。
 * 产物（<out> 目录）：
 *   strings-ascii.txt    全量 ASCII 字符串（"<hex偏移>\t<字符串>"，行号 = 序号 + 1）
 *   strings-utf16le.txt  全量 UTF-16LE 字符串（同格式）
 *   strings-scan.json    结构化摘要（on 回调名、listener、service、关键词命中、富媒体参数证据）
 *
 * 用法：node scripts/probe-scan-strings.mjs [--binary <wrapper.node 路径>] [--out <输出目录>]
 * 默认：--binary = QQNT 9.9.33-52230 wrapper.node；--out = $TEMP/napuketto-probe
 */

import { createHash } from "node:crypto";
import {
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readSync,
    statSync,
    writeFileSync,
    writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ── 配置常量 ──
const DEFAULT_BINARY =
    "C:\\Program Files\\Tencent\\QQNT\\versions\\9.9.33-52230\\resources\\app\\wrapper.node";
const CHUNK_SIZE = 4 * 1024 * 1024;
const MIN_LEN = 4; // 字符串最短长度（含）
const MAX_RUN = 8192; // 单条字符串截断上限（超长 run 分段产出）
const CTX_ON = 10; // on* / 关键词命中上下文半径（条）
const CTX_MEDIA = 30; // downloadRichMedia 上下文半径（条）
const KEYWORD_CTX_CAP = 200; // 每关键词最多带上下文的唯一字符串数
const ON_CTX_CAP = 1000; // 最多带上下文的 on* 名数
const CTX_STR_CAP = 240; // 上下文里单条字符串截断长度

/** 已接线三桥的 listener 方法名（kernel；扫描命中时标记 known，不算新发现）。 */
const KNOWN = {
    Msg: ["onRecvMsg", "onRecvMsgReadReport", "onRecvMsgReceipt", "onMsgInfoListUpdate"],
    Group: [
        "onGroupListInited",
        "onGroupListUpdate",
        "onGroupDetailInfoChange",
        "onMemberInfoChange",
        "onMemberListChange",
        "onGroupNotifiesUpdated",
        "onGroupSingleScreenNotifies",
        "onShutUpMemberListChanged",
    ],
    Buddy: ["onBuddyReqChange", "onBuddyListChange", "onBuddyListChangedV2", "onBuddyDeleted"],
};
const KNOWN_ALL = new Set(Object.values(KNOWN).flat());

/** 语义关键词（小写 includes 匹配；noise/signal 为启发式初判，最终人工复核）。 */
const KEYWORDS = [
    {
        key: "card",
        noise: /cardinality|catch|postcard|sd ?card|sim ?card|cardid|graphic|discard/i,
        signal: /group|member|buddy|nick|on[A-Z]/i,
    },
    {
        key: "sign",
        noise: /design|assign|signal|signature|signed|sign-?in|signin|resign|unsigned|cosign/i,
        signal: /group|on[A-Z]/i,
    },
    { key: "emojilike", signal: /emoji|on[A-Z]/i },
    { key: "emoji_like", signal: /emoji|on[A-Z]/i },
    {
        key: "title",
        noise: /title ?bar|sub ?title|<\/?title|entitle|windowtitle|document\.?title|titleize|tooltip/i,
        signal: /group|member|special|on[A-Z]/i,
    },
    { key: "offlinefile", signal: /offline|file|on[A-Z]/i },
    { key: "offline_file", signal: /offline|file|on[A-Z]/i },
    { key: "notify", noise: /^notify$|^notification$/i, signal: /group|buddy|msg|on[A-Z]/i },
    {
        key: "top",
        noise: /desktop|laptop|topmost|stop\w*|topology|top-|_top|^top$|top ?level/i,
        signal: /group|essence|on[A-Z]/i,
    },
    { key: "essence", signal: /group|essence|on[A-Z]/i },
    { key: "honor", signal: /group|honor|on[A-Z]/i },
    { key: "lucky", signal: /lucky|on[A-Z]/i },
    { key: "poke", noise: /poker|pokemon/i, signal: /poke|nudge|on[A-Z]/i },
    { key: "nudge", signal: /nudge|poke|on[A-Z]/i },
    { key: "typing", noise: /keyboard|duck/i, signal: /input|status|on[A-Z]/i },
    { key: "inputstatus", signal: /input|status|on[A-Z]/i },
];

// ── 命令行参数 ──
function parseArgs(argv) {
    let binary = DEFAULT_BINARY;
    let outDir = join(tmpdir(), "napuketto-probe");
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--binary" && argv[i + 1] !== undefined) {
            binary = resolve(argv[++i]);
        } else if (a === "--out" && argv[i + 1] !== undefined) {
            outDir = resolve(argv[++i]);
        } else {
            console.error(`未知参数或缺值: ${a}`);
            console.error(
                "用法: node scripts/probe-scan-strings.mjs [--binary <wrapper.node>] [--out <dir>]",
            );
            process.exit(2);
        }
    }
    return { binary, outDir };
}

// ── 字符串提取（流式状态机，跨 chunk 边界正确衔接） ──
const asciiOffsets = [];
const asciiStrings = [];
const utf16Offsets = [];
const utf16Strings = [];
const PRINT = (() => {
    const t = new Uint8Array(256);
    for (let c = 0x20; c <= 0x7e; c++) t[c] = 1;
    return t;
})();

function scanBinary(binary) {
    const fd = openSync(binary, "r");
    const size = statSync(binary).size;
    const hash = createHash("sha256");
    const chunk = Buffer.allocUnsafe(CHUNK_SIZE);
    const aScratch = Buffer.alloc(MAX_RUN); // ASCII run 字节
    const uScratch = Buffer.alloc(MAX_RUN); // UTF-16LE run 的低字节序列
    let aLen = 0;
    let aStart = 0;
    let uLen = 0;
    let uStart = 0;
    let uPending = -1; // UTF-16LE 等待高字节 0x00 的低字节（-1 = 无）
    let uPendingOff = 0;

    const flush16 = () => {
        if (uLen >= MIN_LEN) {
            utf16Offsets.push(uStart);
            utf16Strings.push(uScratch.toString("latin1", 0, uLen));
        }
        uLen = 0;
        uPending = -1;
    };

    let pos = 0;
    while (pos < size) {
        const n = readSync(fd, chunk, 0, CHUNK_SIZE, pos);
        if (n <= 0) break;
        hash.update(n === CHUNK_SIZE ? chunk : chunk.subarray(0, n));
        for (let i = 0; i < n; i++) {
            const b = chunk[i];
            const abs = pos + i;
            const pr = PRINT[b];
            // ASCII 通道
            if (pr !== 0) {
                if (aLen === 0) aStart = abs;
                else if (aLen === MAX_RUN) {
                    asciiOffsets.push(aStart);
                    asciiStrings.push(aScratch.toString("latin1", 0, MAX_RUN));
                    aStart = abs;
                    aLen = 0;
                }
                aScratch[aLen++] = b;
            } else if (aLen >= MIN_LEN) {
                asciiOffsets.push(aStart);
                asciiStrings.push(aScratch.toString("latin1", 0, aLen));
                aLen = 0;
            } else {
                aLen = 0;
            }
            // UTF-16LE 通道（低字节可打印 ASCII + 高字节 0x00）
            if (pr !== 0) {
                if (uPending !== -1) flush16();
                uPending = b;
                uPendingOff = abs;
            } else if (b === 0) {
                if (uPending !== -1) {
                    if (uLen === 0) uStart = uPendingOff;
                    else if (uLen === MAX_RUN) {
                        utf16Offsets.push(uStart);
                        utf16Strings.push(uScratch.toString("latin1", 0, MAX_RUN));
                        uStart = uPendingOff;
                        uLen = 0;
                    }
                    uScratch[uLen++] = uPending;
                    uPending = -1;
                } else if (uLen > 0) {
                    flush16();
                }
            } else if (uPending !== -1 || uLen > 0) {
                flush16();
            }
        }
        pos += n;
    }
    // EOF 收尾
    if (aLen >= MIN_LEN) {
        asciiOffsets.push(aStart);
        asciiStrings.push(aScratch.toString("latin1", 0, aLen));
    }
    if (uPending !== -1 || uLen > 0) {
        if (uLen >= MIN_LEN) {
            utf16Offsets.push(uStart);
            utf16Strings.push(uScratch.toString("latin1", 0, uLen));
        }
    }
    closeSync(fd);
    return { size, sha256: hash.digest("hex") };
}

// ── 产物落盘 ──
function dumpStrings(path, offsets, strings) {
    const fd = openSync(path, "w");
    let batch = [];
    for (let i = 0; i < strings.length; i++) {
        batch.push(`${offsets[i].toString(16).padStart(8, "0")}\t${strings[i]}`);
        if (batch.length === 20000) {
            writeSync(fd, batch.join("\n"));
            writeSync(fd, "\n");
            batch = [];
        }
    }
    if (batch.length > 0) {
        writeSync(fd, batch.join("\n"));
        writeSync(fd, "\n");
    }
    closeSync(fd);
}

// ── 上下文工具 ──
const ENCS = [
    { name: "ascii", strings: asciiStrings, offsets: asciiOffsets },
    { name: "utf16le", strings: utf16Strings, offsets: utf16Offsets },
];

function clip(s, o) {
    return { o, s: s.length > CTX_STR_CAP ? `${s.slice(0, CTX_STR_CAP)}…` : s };
}

function contextOf(encName, idx, radius) {
    const enc = ENCS.find((e) => e.name === encName);
    const { strings, offsets } = enc;
    const out = { enc: encName, idx, before: [], after: [] };
    for (let i = Math.max(0, idx - radius); i < idx; i++)
        out.before.push(clip(strings[i], offsets[i]));
    for (let i = idx + 1; i < Math.min(strings.length, idx + radius + 1); i++) {
        out.after.push(clip(strings[i], offsets[i]));
    }
    return out;
}

// ── 分析 a/b：on* / listener / service 提取与分组 ──
const RE_ON = /\bon[A-Z][A-Za-z0-9_]+\b/g;
const RE_ON_LOOSE = /on[A-Z][A-Za-z0-9_]+/g; // 无词边界兜底（防 m_onXxx / z_onXxx 漏检）
const RE_LISTENER = /\baddKernel[A-Za-z0-9_]+Listener\b/g;
const RE_SERVICE = /\bNodeIKernel[A-Za-z0-9_]+Service\b/g;
const RE_IFACE = /\bNodeIKernel[A-Za-z0-9_]+Listener\b/g; // listener 接口名本体

function collectPattern(re) {
    const map = new Map(); // name -> {count, encs:Set, firstEnc, firstIdx, firstOffset}
    for (const enc of ENCS) {
        for (let i = 0; i < enc.strings.length; i++) {
            const s = enc.strings[i];
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(s)) !== null) {
                const name = m[0];
                let e = map.get(name);
                if (e === undefined) {
                    e = {
                        count: 0,
                        encs: new Set(),
                        firstEnc: enc.name,
                        firstIdx: i,
                        firstOffset: enc.offsets[i],
                    };
                    map.set(name, e);
                }
                e.count++;
                e.encs.add(enc.name);
            }
        }
    }
    return map;
}

function firstWord(name) {
    const m = /^on([A-Z][a-z]+)/.exec(name);
    return m !== null ? m[1] : name.slice(2, 8);
}

function analyzeOnEvents(listenerMap, serviceMap) {
    // 词 → 挂载点（addKernel<Word>Listener / NodeIKernel<Word>Service）
    const wordAnchor = new Map();
    for (const name of listenerMap.keys()) {
        const w = name.replace(/^addKernel/, "").replace(/Listener$/, "");
        const a = wordAnchor.get(w) ?? {};
        a.listener = name;
        wordAnchor.set(w, a);
    }
    for (const name of serviceMap.keys()) {
        const w = name.replace(/^NodeIKernel/, "").replace(/Service$/, "");
        const a = wordAnchor.get(w) ?? {};
        a.service = name;
        wordAnchor.set(w, a);
    }

    const bridgeOf = (name) => {
        for (const [bridge, list] of Object.entries(KNOWN)) {
            if (list.includes(name)) return bridge;
        }
        return null;
    };

    const names = [];
    for (const [name, e] of collectPattern(RE_ON)) {
        const bridge = bridgeOf(name);
        const word = firstWord(name);
        let group;
        if (bridge !== null) {
            group = `known:${bridge}桥`;
        } else if (["Group", "Buddy", "Msg", "Emoji", "Recv"].includes(word)) {
            group = `on${word}*`;
        } else {
            group = `其他:on${word}*`;
        }
        const guess =
            wordAnchor.get(word) ?? (word === "Recv" ? (wordAnchor.get("Msg") ?? null) : null);
        names.push({
            name,
            count: e.count,
            encs: [...e.encs],
            known: bridge !== null,
            bridge,
            group,
            guess:
                guess === null || guess === undefined
                    ? null
                    : { listener: guess.listener ?? null, service: guess.service ?? null },
            first: { enc: e.firstEnc, idx: e.firstIdx, offset: e.firstOffset },
        });
    }
    names.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

    // 无词边界兜底：loose 命中但严格模式漏掉的名字（多为前缀粘连噪音，人工判定）
    const strictSet = new Set(names.map((n) => n.name));
    const loose = collectPattern(RE_ON_LOOSE);
    const looseExtra = [];
    for (const [name, e] of loose) {
        if (strictSet.has(name)) continue;
        // 若 loose 名字是某严格名字的后缀（粘连前缀），仍记录但标注
        looseExtra.push({ name, count: e.count, firstEnc: e.firstEnc, firstIdx: e.firstIdx });
    }
    looseExtra.sort((a, b) => b.count - a.count);

    // 上下文：优先 五事件信号词 > 其他未知 > known；unknown 才给（known 不需要证据）
    const SIGNAL_RE = /card|sign|emoji|title|offline|essence|honor|lucky|poke|nudge|typing|input/i;
    const withCtx = names
        .filter((n) => !n.known)
        .sort((a, b) => {
            const rank = (n) => (SIGNAL_RE.test(n.name) ? 0 : 1);
            return rank(a) - rank(b) || a.name.localeCompare(b.name);
        })
        .slice(0, ON_CTX_CAP)
        .map((n) => ({ ...n, ctx: contextOf(n.first.enc, n.first.idx, CTX_ON) }));

    const groups = {};
    for (const n of names) {
        (groups[n.group] ??= []).push(n.name);
    }
    return { groups, names, looseExtra: looseExtra.slice(0, 300), withContext: withCtx };
}

// ── 分析 c：关键词命中（唯一字符串 + 上下文 + 信号/噪音初判） ──
function tagHit(def, str) {
    const sig = def.signal !== undefined && def.signal.test(str);
    const noise = def.noise !== undefined && def.noise.test(str);
    if (sig && !noise) return "signal";
    if (noise && !sig) return "noise";
    return "maybe";
}

function collectKeywordHits() {
    const result = {};
    for (const def of KEYWORDS) {
        const uniq = new Map(); // str -> entry
        for (const enc of ENCS) {
            for (let i = 0; i < enc.strings.length; i++) {
                const low = enc.strings[i].toLowerCase();
                if (!low.includes(def.key)) continue;
                let e = uniq.get(low);
                if (e === undefined) {
                    e = {
                        str: enc.strings[i],
                        count: 0,
                        encs: new Set(),
                        firstEnc: enc.name,
                        firstIdx: i,
                        firstOffset: enc.offsets[i],
                    };
                    uniq.set(low, e);
                }
                e.count++;
                e.encs.add(enc.name);
            }
        }
        const list = [...uniq.values()].map((e) => ({
            str: e.str,
            count: e.count,
            encs: [...e.encs],
            firstEnc: e.firstEnc,
            firstIdx: e.firstIdx,
            firstOffset: e.firstOffset,
            tag: tagHit(def, e.str),
        }));
        const rank = { signal: 0, maybe: 1, noise: 2 };
        list.sort(
            (a, b) => rank[a.tag] - rank[b.tag] || b.count - a.count || a.str.length - b.str.length,
        );
        result[def.key] = {
            uniqueStrings: list.length,
            hits: list.slice(0, KEYWORD_CTX_CAP).map((h) => ({
                str: h.str,
                count: h.count,
                encs: h.encs,
                tag: h.tag,
                first: { enc: h.firstEnc, idx: h.firstIdx, offset: h.firstOffset },
                ctx: contextOf(h.firstEnc, h.firstIdx, CTX_ON),
            })),
        };
    }
    return result;
}

// ── 分析 d：downloadRichMedia 出现点 ±30 邻近 + 参数断言 ──
function collectMediaEvidence() {
    const hits = [];
    for (const enc of ENCS) {
        for (let i = 0; i < enc.strings.length; i++) {
            if (enc.strings[i].includes("downloadRichMedia")) {
                hits.push({
                    enc: enc.name,
                    idx: i,
                    offset: enc.offsets[i],
                    str: enc.strings[i],
                    ctx: contextOf(enc.name, i, CTX_MEDIA),
                });
            }
        }
    }
    // napi 参数个数断言类字符串（如 "needs N arguments" / "wrong number of arguments"）
    const RE_ARG =
        /(needs?|wrong|expects?|requires?)[^\n]{0,40}arguments?|arguments?[^\n]{0,20}(needs?|wrong|expects?|requires?)/i;
    const assertions = [];
    for (const enc of ENCS) {
        for (let i = 0; i < enc.strings.length && assertions.length < 200; i++) {
            if (RE_ARG.test(enc.strings[i])) {
                assertions.push({
                    enc: enc.name,
                    idx: i,
                    offset: enc.offsets[i],
                    str: enc.strings[i],
                });
            }
        }
    }
    return { hits, argumentAssertions: assertions };
}

// ── 主流程 ──
function main() {
    const { binary, outDir } = parseArgs(process.argv.slice(2));
    if (!existsSync(binary)) {
        console.error(`[fatal] 二进制不存在: ${binary}`);
        process.exit(1);
    }
    mkdirSync(outDir, { recursive: true });
    const t0 = Date.now();
    console.log(`[scan] ${binary}`);
    const { size, sha256 } = scanBinary(binary);
    const scanMs = Date.now() - t0;
    console.log(
        `[scan] 完成: ${(size / 1024 / 1024).toFixed(1)}MB, sha256=${sha256.slice(0, 16)}…, ASCII=${asciiStrings.length}, UTF16LE=${utf16Strings.length}, ${scanMs}ms`,
    );

    const asciiTxt = join(outDir, "strings-ascii.txt");
    const utf16Txt = join(outDir, "strings-utf16le.txt");
    dumpStrings(asciiTxt, asciiOffsets, asciiStrings);
    dumpStrings(utf16Txt, utf16Offsets, utf16Strings);

    const listenerMap = collectPattern(RE_LISTENER);
    const serviceMap = collectPattern(RE_SERVICE);
    const ifaceMap = collectPattern(RE_IFACE);
    const onAnalysis = analyzeOnEvents(listenerMap, serviceMap);
    const keywordHits = collectKeywordHits();
    const media = collectMediaEvidence();

    const summary = {
        meta: {
            scannedAt: new Date().toISOString(),
            binary,
            sizeBytes: size,
            sha256,
            scanMs,
            chunkSize: CHUNK_SIZE,
            minLen: MIN_LEN,
            note: "只读字符串扫描（接口字符串事实，非 RVA/偏移）；信号/噪音标签为启发式初判，需人工复核",
        },
        files: { ascii: asciiTxt, utf16le: utf16Txt },
        counts: {
            asciiStrings: asciiStrings.length,
            utf16leStrings: utf16Strings.length,
            uniqueOnNames: onAnalysis.names.length,
            knownOnNames: onAnalysis.names.filter((n) => n.known).length,
            listenerRegistrations: listenerMap.size,
            serviceNames: serviceMap.size,
            listenerInterfaces: ifaceMap.size,
        },
        onEvents: onAnalysis,
        listeners: [...listenerMap.entries()]
            .map(([name, e]) => ({ name, count: e.count, encs: [...e.encs] }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        services: [...serviceMap.entries()]
            .map(([name, e]) => ({ name, count: e.count, encs: [...e.encs] }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        listenerInterfaces: [...ifaceMap.entries()]
            .map(([name, e]) => ({ name, count: e.count, encs: [...e.encs] }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        keywordHits,
        media,
    };
    const jsonPath = join(outDir, "strings-scan.json");
    writeFileSync(jsonPath, JSON.stringify(summary, null, 2));

    // 控制台摘要
    console.log(`[out] ${asciiTxt} (${asciiStrings.length} 条)`);
    console.log(`[out] ${utf16Txt} (${utf16Strings.length} 条)`);
    console.log(`[out] ${jsonPath}`);
    console.log(
        `[on*] 唯一名 ${onAnalysis.names.length}（known ${summary.counts.knownOnNames} / 未知 ${onAnalysis.names.length - summary.counts.knownOnNames}）`,
    );
    for (const [g, list] of Object.entries(onAnalysis.groups)) {
        console.log(`[on*] ${g}: ${list.length} 个`);
    }
    console.log(`[listener] addKernel*Listener: ${[...listenerMap.keys()].join(", ")}`);
    console.log(`[service] NodeIKernel*Service: ${serviceMap.size} 个`);
    console.log(`[iface] NodeIKernel*Listener: ${ifaceMap.size} 个`);
    for (const [key, r] of Object.entries(keywordHits)) {
        const sig = r.hits.filter((h) => h.tag === "signal").length;
        console.log(`[kw] ${key}: 唯一串 ${r.uniqueStrings}, top${r.hits.length} 中 signal ${sig}`);
    }
    console.log(
        `[media] downloadRichMedia 出现点 ${media.hits.length} 个, 参数断言串 ${media.argumentAssertions.length} 条`,
    );
    console.log(`[done] 总耗时 ${Date.now() - t0}ms`);
}

main();
