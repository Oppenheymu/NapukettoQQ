/**
 * OB11Constructor：canonical 元素 ↔ OB11 segment / CQ 码（ADR-008 翻译层）
 *
 * 纯函数：只读入参、无副作用，翻译只做结构映射，不调 API、不读缓存。
 * NT 实体 ↔ canonical 在 kernel（types/message-element.ts），本文件只做
 * canonical ↔ OB11（segment / CQ 码）的薄映射。
 */

import type { CanonicalElement } from "@napuketto/kernel";
import type { OB11MessageSegment } from "../types/index.js";
import { type CqCode, encodeCqCode, escapeCqText, parseCqMessage } from "./cqcode.js";

/** OB11 媒体段 data（image/record/video 共用，url 可选）。 */
function mediaData(file: string, url: string | undefined): { file: string; url?: string } {
    const data: { file: string; url?: string } = { file };
    if (url !== undefined) {
        data.url = url;
    }
    return data;
}

/** OB11 at 段 data（name 可选）。 */
function atData(qq: string, name: string | undefined): { qq: string; name?: string } {
    const data: { qq: string; name?: string } = { qq };
    if (name !== undefined) {
        data.name = name;
    }
    return data;
}

/** canonical at 元素（display 可选）。 */
function canonicalAt(target: string, display: string | undefined): CanonicalElement {
    const el: CanonicalElement = { type: "at", target };
    if (display !== undefined) {
        el.display = display;
    }
    return el;
}

/** canonical 媒体元素子集（image/voice/video 均含 url 可选字段）。 */
type MediaCanonical =
    | { type: "image"; path: string; url?: string; size?: { width: number; height: number } }
    | { type: "voice"; path: string; url?: string }
    | { type: "video"; path: string; url?: string };

/** canonical 媒体元素（image/voice/video，url 可选；type 为联合需断言收窄）。 */
function canonicalMedia(
    type: "image" | "voice" | "video",
    path: string,
    url: string | undefined,
): CanonicalElement {
    const el: MediaCanonical = { type, path } as MediaCanonical;
    if (url !== undefined) {
        el.url = url;
    }
    return el;
}

/** canonical json/xml 的 raw → OB11 data 字符串（字符串原样，对象序列化）。 */
function rawToString(raw: unknown): string {
    if (typeof raw === "string") {
        return raw;
    }
    return JSON.stringify(raw);
}

/** canonical 元素 → OB11 segment（null = OB11 无法表达，跳过）。 */
function canonicalToSegment(el: CanonicalElement): OB11MessageSegment | null {
    if (el.type === "text") {
        return { type: "text", data: { text: el.text } };
    }
    if (el.type === "at") {
        return { type: "at", data: atData(el.target, el.display) };
    }
    if (el.type === "image") {
        return { type: "image", data: mediaData(el.path, el.url) };
    }
    if (el.type === "face") {
        return { type: "face", data: { id: el.id } };
    }
    if (el.type === "voice") {
        return { type: "record", data: mediaData(el.path, el.url) };
    }
    if (el.type === "video") {
        return { type: "video", data: mediaData(el.path, el.url) };
    }
    if (el.type === "reply") {
        return { type: "reply", data: { id: el.messageId } };
    }
    if (el.type === "forward") {
        return { type: "forward", data: { id: el.messageIds[0] ?? "" } };
    }
    if (el.type === "json") {
        return { type: "json", data: { data: rawToString(el.raw) } };
    }
    if (el.type === "xml") {
        return { type: "xml", data: { data: rawToString(el.raw) } };
    }
    // file / unknown：OB11 无对应消息段，跳过
    return null;
}

/** OB11 segment → canonical 元素。 */
function segmentToCanonical(seg: OB11MessageSegment): CanonicalElement | null {
    if (seg.type === "text" || seg.type === "string") {
        return { type: "text", text: seg.data.text };
    }
    if (seg.type === "at") {
        return canonicalAt(seg.data.qq, seg.data.name);
    }
    if (seg.type === "face") {
        return { type: "face", id: seg.data.id };
    }
    if (seg.type === "image") {
        return canonicalMedia("image", seg.data.file, seg.data.url);
    }
    if (seg.type === "record") {
        return canonicalMedia("voice", seg.data.file, seg.data.url);
    }
    if (seg.type === "video") {
        return canonicalMedia("video", seg.data.file, seg.data.url);
    }
    if (seg.type === "reply") {
        return { type: "reply", messageId: seg.data.id };
    }
    if (seg.type === "forward") {
        return { type: "forward", messageIds: [seg.data.id] };
    }
    if (seg.type === "json") {
        return { type: "json", raw: seg.data.data };
    }
    return { type: "xml", raw: seg.data.data };
}

/** CQ 段构造器（params 键可能缺失，undefined 用空串兜底）。 */
type CqSegmentBuilder = (params: Record<string, string | undefined>) => OB11MessageSegment;

/** 已知 CQ 类型 → segment 构造器。 */
const CQ_SEGMENT_BUILDERS: Record<string, CqSegmentBuilder> = {
    text: (params) => ({ type: "text", data: { text: params["text"] ?? "" } }),
    at: (params) => ({ type: "at", data: atData(params["qq"] ?? "", params["name"]) }),
    face: (params) => ({ type: "face", data: { id: params["id"] ?? "" } }),
    image: (params) => ({
        type: "image",
        data: mediaData(params["file"] ?? "", params["url"]),
    }),
    record: (params) => ({
        type: "record",
        data: mediaData(params["file"] ?? "", params["url"]),
    }),
    video: (params) => ({
        type: "video",
        data: mediaData(params["file"] ?? "", params["url"]),
    }),
    reply: (params) => ({ type: "reply", data: { id: params["id"] ?? "" } }),
    forward: (params) => ({ type: "forward", data: { id: params["id"] ?? "" } }),
    json: (params) => ({ type: "json", data: { data: params["data"] ?? "" } }),
    xml: (params) => ({ type: "xml", data: { data: params["data"] ?? "" } }),
};

/** CQ 码片段 → OB11 segment（未知类型保留原文为 text 段，往返不丢数据）。 */
function cqCodeToSegment(code: CqCode): OB11MessageSegment | null {
    const builder = CQ_SEGMENT_BUILDERS[code.type];
    if (builder === undefined) {
        // 未知 CQ 类型：保留原文为文本段（go-cqhttp 兼容行为）
        return { type: "text", data: { text: encodeCqCode(code.type, code.params) } };
    }
    return builder(code.params);
}

/** canonical 元素数组 → OB11 segment 数组（无法表达的元素静默跳过）。 */
export function canonicalToSegments(elements: CanonicalElement[]): OB11MessageSegment[] {
    const segments: OB11MessageSegment[] = [];
    for (const el of elements) {
        const seg = canonicalToSegment(el);
        if (seg !== null) {
            segments.push(seg);
        }
    }
    return segments;
}

/** OB11 segment 数组 → canonical 元素数组。 */
export function segmentsToCanonical(segments: OB11MessageSegment[]): CanonicalElement[] {
    const elements: CanonicalElement[] = [];
    for (const seg of segments) {
        const el = segmentToCanonical(seg);
        if (el !== null) {
            elements.push(el);
        }
    }
    return elements;
}

/** OB11 segment 数组 → CQ 码字符串（text 段转义拼接，特殊段编码）。 */
export function segmentsToCqMessage(segments: OB11MessageSegment[]): string {
    let out = "";
    for (const seg of segments) {
        if (seg.type === "text" || seg.type === "string") {
            out += escapeCqText(seg.data.text);
        } else {
            out += encodeCqCode(seg.type, seg.data);
        }
    }
    return out;
}

/**
 * 接收方向翻译上下文（ID 空间转换，P2-19，2026-08-07）。
 * 翻译核心保持纯函数（ADR-008），调用方在协议边界准备上下文注入：
 * canonical 的 at.target 是 NT uid、reply.messageId 是 NT 雪花 msgId，
 * OB11 需要 uin / OB11 message_id。
 */
export interface ReceiveTranslateContext {
    /** uid → uin 映射（at 段目标转换；缺省不转换）。 */
    uidToUin?: Map<string, string>;
    /** NT msgId → OB11 message_id（reply 段转换；缺省不转换）。 */
    msgIdToOb11Id?: (msgId: string) => number | undefined;
}

/**
 * 收集 canonical 元素里需要转换的 at uid / reply NT msgId（接收方向）。
 * 调用方据此批量 uidToUin（一次异步调用），避免逐元素查询。
 */
export function collectReceiveNeeds(elements: CanonicalElement[]): {
    atUids: string[];
    replyMsgIds: string[];
} {
    const atUids = new Set<string>();
    const replyMsgIds = new Set<string>();
    for (const el of elements) {
        if (el.type === "at" && el.target !== "all") {
            atUids.add(el.target);
        } else if (el.type === "reply") {
            replyMsgIds.add(el.messageId);
        }
    }
    return { atUids: [...atUids], replyMsgIds: [...replyMsgIds] };
}

/**
 * canonical 元素数组 → 应用接收方向 ID 转换（at uid→uin、reply NT msgId→OB11 id）。
 * 转换失败的元素原样保留（uid 未解析 / msgId 未映射——不阻塞上报）。
 */
export function applyReceiveContext(
    elements: CanonicalElement[],
    ctx: ReceiveTranslateContext,
): CanonicalElement[] {
    if (ctx.uidToUin === undefined && ctx.msgIdToOb11Id === undefined) {
        return elements;
    }
    const out: CanonicalElement[] = [];
    for (const el of elements) {
        if (el.type === "at" && el.target !== "all") {
            const uin = ctx.uidToUin?.get(el.target);
            out.push(uin !== undefined ? { ...el, target: uin } : el);
            continue;
        }
        if (el.type === "reply") {
            const id = ctx.msgIdToOb11Id?.(el.messageId);
            out.push(id !== undefined ? { ...el, messageId: String(id) } : el);
            continue;
        }
        out.push(el);
    }
    return out;
}

/**
 * 发送方向翻译上下文（ID 空间转换，P2-19，2026-08-07）。
 * OB11 的 at.qq 是 uin、reply.id 是 OB11 message_id，canonical 需要 uid / NT msgId。
 */
export interface SendTranslateContext {
    /** uin → uid 映射（at 段目标转换；缺省不转换）。 */
    uinToUid?: Map<string, string>;
    /** OB11 message_id → NT msgId（reply 段转换；缺省原样透传）。 */
    ob11IdToMsgId?: (id: number) => string | undefined;
}

/**
 * canonical 元素数组 → 应用发送方向 ID 转换（at uin→uid、reply OB11 id→NT msgId）。
 * reply 反查不到时原样透传（兼容客户端直接给 NT msgId 的输入，不报错）。
 */
export function applySendContext(
    elements: CanonicalElement[],
    ctx: SendTranslateContext,
): CanonicalElement[] {
    if (ctx.uinToUid === undefined && ctx.ob11IdToMsgId === undefined) {
        return elements;
    }
    const out: CanonicalElement[] = [];
    for (const el of elements) {
        if (el.type === "at" && el.target !== "all") {
            const uid = ctx.uinToUid?.get(el.target);
            out.push(uid !== undefined ? { ...el, target: uid } : el);
            continue;
        }
        if (el.type === "reply") {
            const num = Number(el.messageId);
            if (!Number.isNaN(num)) {
                const msgId = ctx.ob11IdToMsgId?.(num);
                if (msgId !== undefined) {
                    out.push({ ...el, messageId: msgId });
                    continue;
                }
            }
            out.push(el);
            continue;
        }
        out.push(el);
    }
    return out;
}

/** CQ 码字符串 → OB11 segment 数组（未知 CQ 类型保留为 text 段原文）。 */
export function cqMessageToSegments(text: string): OB11MessageSegment[] {
    const segments: OB11MessageSegment[] = [];
    for (const part of parseCqMessage(text)) {
        if (typeof part === "string") {
            if (part.length > 0) {
                segments.push({ type: "text", data: { text: part } });
            }
        } else {
            const seg = cqCodeToSegment(part);
            if (seg !== null) {
                segments.push(seg);
            }
        }
    }
    return segments;
}

/** canonical 元素数组 → CQ 码字符串。 */
export function canonicalToCqMessage(elements: CanonicalElement[]): string {
    return segmentsToCqMessage(canonicalToSegments(elements));
}

/** CQ 码字符串 → canonical 元素数组。 */
export function cqMessageToCanonical(text: string): CanonicalElement[] {
    return segmentsToCanonical(cqMessageToSegments(text));
}
