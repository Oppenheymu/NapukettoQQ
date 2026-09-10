/**
 * OB11 sysmsg 解码与翻译（2026-09-10，design.md §7）
 *
 * Msg/onRecvSysMsg 是群名片/头衔/签到等系统事件的 sys msg 总闸，payload =
 * 原始 protobuf 字节（djinni int8 数组透传，实测 `[[10,64,…]]` 形状）。本模块：
 *  - decodeProtoTree：手写 protobuf wire-format 解码器（varint/length-delimited，
 *    零依赖，BigInt 保 64 位精度）
 *  - narrowSysMsgBlobs：回调参数防御性收窄（未知形状 → null，调用方打 raw 日志）
 *  - extractSysMsgEnvelope：按实测样本布局提取信封（design.md §7.3，逐字段可空）
 *  - recognizeSysMsg + KIND_TABLE：(msgType, subType) → 事件种类。
 *    ⚠️ 表当前为空——card/title/sign 的判别值无样本支撑，宁可漏报不错报
 *    （design.md §7.5）；未识别一律走结构化校准日志，不广播。
 *
 * 证据：2 条真实样本（c3 观测窗 2026-09-09，各 151 字节，均为 528/382 未命名
 * 类型）+ wrapper.node OnSysMsg* 处理器分类学（strings 扫描，原生分发键 =
 * msg_type/sub_type）。翻译纯函数（ADR-008）。
 */

import type { OB11NoticeEvent } from "../event/index.js";

// ---------------------------------------------------------------------------
// wire-format 解码器
// ---------------------------------------------------------------------------

/** 递归深度上限（防御：恶意/畸形字节防栈溢出）。 */
const MAX_DEPTH = 16;

/** 单层字段数上限。 */
const MAX_FIELDS = 256;

/** 单个 varint 最大字节数（64 位 + 1 冗余）。 */
const MAX_VARINT_BYTES = 10;

/** protobuf 字段树节点（判别联合）。 */
export type SysMsgField =
    | {
          readonly no: number;
          readonly kind: "varint";
          /** 原始 64 位值（BigInt；安全转换走 varintToNumber）。 */
          readonly value: bigint;
      }
    | {
          readonly no: number;
          readonly kind: "bytes";
          readonly value: Uint8Array;
          /** 子树（try-parse 成功时；null = 不透明字节，empty [] = 空消息）。 */
          readonly children: readonly SysMsgField[] | null;
      };

/** 读 varint：成功返回 [值, 下一偏移]，越界/超长返回 null。 */
function readVarint(data: Uint8Array, start: number): [bigint, number] | null {
    let value = 0n;
    let shift = 0n;
    let i = start;
    while (true) {
        if (i >= data.length || i - start >= MAX_VARINT_BYTES) {
            return null;
        }
        const byte = data[i];
        if (byte === undefined) {
            return null;
        }
        i += 1;
        value |= BigInt(byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) {
            return [value, i];
        }
        shift += 7n;
    }
}

/** 单字段解码产物：field = 产出节点（定长跳过类无产出），next = 下一偏移。 */
interface DecodedField {
    readonly field: SysMsgField | undefined;
    readonly next: number;
}

/** wire 2：length-delimited 字段（递归 try-parse 子树，失败 → 不透明字节）。 */
function decodeLengthDelimited(
    data: Uint8Array,
    afterTag: number,
    no: number,
    depth: number,
): DecodedField | null {
    const len = readVarint(data, afterTag);
    if (len === null) {
        return null;
    }
    const payloadStart = len[1];
    const end = payloadStart + Number(len[0]);
    if (end > data.length) {
        return null;
    }
    const slice = data.slice(payloadStart, end);
    return {
        field: { no, kind: "bytes", value: slice, children: decodeProtoTree(slice, depth + 1) },
        next: end,
    };
}

/** 解码单个带 tag 字段；畸形（field 0 / group / 截断 / 越界）返回 null。 */
function decodeTaggedField(data: Uint8Array, start: number, depth: number): DecodedField | null {
    const tag = readVarint(data, start);
    if (tag === null) {
        return null;
    }
    const [tagValue, afterTag] = tag;
    const no = Number(tagValue >> 3n);
    const wireType = Number(tagValue & 7n);
    if (no === 0) {
        return null;
    }
    if (wireType === 0) {
        const v = readVarint(data, afterTag);
        if (v === null) {
            return null;
        }
        return { field: { no, kind: "varint", value: v[0] }, next: v[1] };
    }
    if (wireType === 2) {
        return decodeLengthDelimited(data, afterTag, no, depth);
    }
    if (wireType === 1 || wireType === 5) {
        const next = afterTag + (wireType === 1 ? 8 : 4);
        return next > data.length ? null : { field: undefined, next };
    }
    return null; // wire 3/4（group）未观测到，整层判失败
}

/**
 * 解码 protobuf wire-format 为递归字段树（不维护字段重复/顺序语义以外的信息）。
 *
 * - wire 0 varint / wire 2 length-delimited：支持；wire 2 递归 try-parse，
 *   子解析失败按不透明字节挂树（ASCII 串偶发误判嵌套无实害——树仅用于观测）。
 * - wire 1/5（fixed64/32）：跳过（QQ NT blob 未观测到，防御性兼容）。
 * - wire 3/4（group）、截断、field 0、超限：判失败返回 null。
 */
export function decodeProtoTree(data: Uint8Array, depth = 0): readonly SysMsgField[] | null {
    if (depth > MAX_DEPTH) {
        return null;
    }
    const fields: SysMsgField[] = [];
    let i = 0;
    while (i < data.length) {
        if (fields.length >= MAX_FIELDS) {
            return null;
        }
        const decoded = decodeTaggedField(data, i, depth);
        if (decoded === null) {
            return null;
        }
        if (decoded.field !== undefined) {
            fields.push(decoded.field);
        }
        i = decoded.next;
    }
    return fields;
}

/** 取字段号首个命中的节点。 */
function firstField(tree: readonly SysMsgField[], no: number): SysMsgField | undefined {
    return tree.find((f) => f.no === no);
}

/** varint → number（超安全整数返回 null，调用方按缺字段处理）。 */
export function varintToNumber(value: bigint): number | null {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

/** UTF-8 严格解码 + 可打印检查（含控制字符判不可解码，返回 null）。 */
function decodeText(bytes: Uint8Array): string | null {
    try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        for (const ch of text) {
            const code = ch.codePointAt(0) ?? 0;
            if (code < 0x20 && code !== 0x09) {
                return null;
            }
        }
        return text;
    } catch {
        return null;
    }
}

/** 递归收集树内全部可打印字符串（校准观测用；先序遍历，空字节段跳过）。 */
export function collectStrings(tree: readonly SysMsgField[]): string[] {
    const out: string[] = [];
    for (const f of tree) {
        if (f.kind === "varint") {
            continue;
        }
        const text = decodeText(f.value);
        if (text !== null && text.length > 0) {
            out.push(text);
        }
        if (f.children !== null) {
            out.push(...collectStrings(f.children));
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// 回调参数收窄（onRecvSysMsg arg = 带符号字节数组的数组，design.md §7.2）
// ---------------------------------------------------------------------------

/** 单个候选块 → Uint8Array（number[] -128..255 / TypedArray；其余 null）。 */
function toBlob(item: unknown): Uint8Array | null {
    if (item instanceof Uint8Array) {
        return new Uint8Array(item);
    }
    if (item instanceof Int8Array) {
        return Uint8Array.from(item, (b) => b & 0xff);
    }
    if (Array.isArray(item) && item.length > 0) {
        const out = new Uint8Array(item.length);
        for (let i = 0; i < item.length; i += 1) {
            const b = item[i];
            // 非整数拒绝：浮点 & 0xff 会静默截断成别的字节
            if (typeof b !== "number" || !Number.isInteger(b) || b < -128 || b > 255) {
                return null;
            }
            out[i] = b & 0xff;
        }
        return out;
    }
    return null;
}

/**
 * onRecvSysMsg 参数 → sysmsg 字节块列表（防御性收窄）。
 * 接受批数组（实测形状）/ 单块裸数组 / TypedArray；零有效块返回 null
 * （调用方打 raw 日志，与 narrowOfflineFiles 同模式）。
 */
export function narrowSysMsgBlobs(arg: unknown): readonly Uint8Array[] | null {
    if (Array.isArray(arg)) {
        // 优先按「批」解释（实测：外层数组内层字节块）
        const blobs = arg.map(toBlob).filter((b): b is Uint8Array => b !== null);
        if (blobs.length > 0) {
            return blobs;
        }
        // 兜底：arg 本身是裸字节数组
        const single = toBlob(arg);
        return single === null ? null : [single];
    }
    const single = toBlob(arg);
    return single === null ? null : [single];
}

// ---------------------------------------------------------------------------
// 信封提取（字段号依据 = design.md §7.3 样本观察，逐字段软失败）
// ---------------------------------------------------------------------------

/** 实测样本信封（全部可空 = 提取失败不打死整条事件）。 */
export interface SysMsgEnvelope {
    /** f1.f1：行为人 uin（观测 = 自身账号；语义待校准）。 */
    actorUin: number | null;
    /** f1.f2：行为人 uid。 */
    actorUid: string | null;
    /** f1.f5：对象 uin（观测与 actor 相等）。 */
    targetUin: number | null;
    /** f1.f6：对象 uid。 */
    targetUid: string | null;
    /** f2.f1：msgType（原生分发键之一）。 */
    msgType: number | null;
    /** f2.f2：subType（原生分发键之一）。 */
    subType: number | null;
    /** f2.f3：备用 subType（观测恒等于 subType）。 */
    subTypeAlt: number | null;
    /** f2.f4/f5：群标识对（观测恒相邻整数，语义待校准）。 */
    groupCodes: readonly [number, number] | null;
    /** f2.f6：事件时间戳（秒）。 */
    time: number | null;
    /** 树内全部可打印字符串（校准观测用，含 base64 文本）。 */
    strings: readonly string[];
}

/** 顶层 f1 块的字段（uin/uid 对）。 */
function extractActorBlock(block: readonly SysMsgField[] | null): {
    uin: number | null;
    uid: string | null;
    uin2: number | null;
    uid2: string | null;
} {
    const empty = { uin: null, uid: null, uin2: null, uid2: null };
    if (block === null) {
        return empty;
    }
    const f1 = firstField(block, 1);
    const f2 = firstField(block, 2);
    const f5 = firstField(block, 5);
    const f6 = firstField(block, 6);
    return {
        uin: f1?.kind === "varint" ? varintToNumber(f1.value) : null,
        uid: f2?.kind === "bytes" ? decodeText(f2.value) : null,
        uin2: f5?.kind === "varint" ? varintToNumber(f5.value) : null,
        uid2: f6?.kind === "bytes" ? decodeText(f6.value) : null,
    };
}

/** 顶层 f2 块 → 信封数值字段。 */
function extractEnvelopeBlock(
    block: readonly SysMsgField[] | null,
): Pick<SysMsgEnvelope, "msgType" | "subType" | "subTypeAlt" | "groupCodes" | "time"> {
    const empty = { msgType: null, subType: null, subTypeAlt: null, groupCodes: null, time: null };
    if (block === null) {
        return empty;
    }
    const num = (no: number): number | null => {
        const f = firstField(block, no);
        return f?.kind === "varint" ? varintToNumber(f.value) : null;
    };
    const code4 = num(4);
    const code5 = num(5);
    return {
        msgType: num(1),
        subType: num(2),
        subTypeAlt: num(3),
        groupCodes: code4 !== null && code5 !== null ? ([code4, code5] as const) : null,
        time: num(6),
    };
}

/** 字段树 → 信封（design.md §7.3；任何字段缺失/非法 = null，不抛错）。 */
export function extractSysMsgEnvelope(tree: readonly SysMsgField[]): SysMsgEnvelope {
    const actor = extractActorBlock(getChildren(firstField(tree, 1)));
    return {
        actorUin: actor.uin,
        actorUid: actor.uid,
        targetUin: actor.uin2,
        targetUid: actor.uid2,
        ...extractEnvelopeBlock(getChildren(firstField(tree, 2))),
        strings: collectStrings(tree),
    };
}

/** bytes 节点的子树（非 bytes/不透明 → null）。 */
function getChildren(field: SysMsgField | undefined): readonly SysMsgField[] | null {
    return field?.kind === "bytes" ? field.children : null;
}

// ---------------------------------------------------------------------------
// 识别层（design.md §7.5：不得猜错还硬广播）
// ---------------------------------------------------------------------------

/** sysmsg 可映射的 OB11 notice 种类（event/notice.ts 既有类型）。 */
export type SysMsgNoticeKind = "group_card" | "group_title" | "group_sign";

/** 单条识别规则：表命中后从字段树提取广播体；提取失败 → null（降级校准日志）。 */
export interface SysMsgKindRule {
    readonly kind: SysMsgNoticeKind;
    extract(tree: readonly SysMsgField[], env: SysMsgEnvelope): OB11NoticeEvent | null;
}

/**
 * (msgType, subType) → 规则表，主键 `"${msgType}:${subType}"`（原生分发键，
 * design.md §7.1）。
 *
 * ⚠️ 当前为空：c3 以来的全部真实样本（2 条）均为 528/382 未命名类型，
 * card/title/sign 的判别值没有样本支撑——在此登记规则前不会广播任何 sysmsg
 * notice。拿到真实样本后登记 extract 规则即可（规则实现参考
 * notice-extra.ts 防御性收窄风格）。
 */
const KIND_TABLE: ReadonlyMap<string, SysMsgKindRule> = new Map();

/** 已观测但未命名的 (msgType, subType)：c3 双样本 528/382（语义未知）。 */
const OBSERVED_UNNAMED: ReadonlySet<string> = new Set(["528:382"]);

/** 识别结果三态。 */
export type SysMsgRecognition =
    | { readonly kind: "notice"; readonly rule: SysMsgKindRule }
    | { readonly kind: "observed_unnamed" }
    | { readonly kind: "unknown" };

/**
 * (msgType, subType) → 识别结果。table 参数供单测注入合成规则（生产走
 * KIND_TABLE）。
 */
export function recognizeSysMsg(
    msgType: number | null,
    subType: number | null,
    table: ReadonlyMap<string, SysMsgKindRule> = KIND_TABLE,
): SysMsgRecognition {
    if (msgType === null || subType === null) {
        return { kind: "unknown" };
    }
    const rule = table.get(`${msgType}:${subType}`);
    if (rule !== undefined) {
        return { kind: "notice", rule };
    }
    return OBSERVED_UNNAMED.has(`${msgType}:${subType}`)
        ? { kind: "observed_unnamed" }
        : { kind: "unknown" };
}

/** 字节块 → 小写 hex（校准日志用；超长由调用方截断）。 */
export function toHex(bytes: Uint8Array): string {
    let out = "";
    for (const b of bytes) {
        out += b.toString(16).padStart(2, "0");
    }
    return out;
}
