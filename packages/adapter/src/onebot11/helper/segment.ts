/**
 * OB11 segment 单元素转换（从 data.ts 拆分，2026-08-08 FTA 优化）
 *
 * - canonicalToSegment / segmentToCanonical：单元素 ↔ 单 segment（null = 无法表达跳过）
 * - CQ_SEGMENT_BUILDERS / cqCodeToSegment：CQ 码 → segment（未知类型保留原文为文本段）
 */
import type { CanonicalElement } from "@napuketto/kernel";
import type { OB11MessageSegment } from "../types/index.js";
import { type CqCode, encodeCqCode, escapeCqText } from "./cqcode.js";

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
export function canonicalToSegment(el: CanonicalElement): OB11MessageSegment | null {
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
export function segmentToCanonical(seg: OB11MessageSegment): CanonicalElement | null {
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
export function cqCodeToSegment(code: CqCode): OB11MessageSegment | null {
    const builder = CQ_SEGMENT_BUILDERS[code.type];
    if (builder === undefined) {
        // 未知 CQ 类型：保留原文为文本段（go-cqhttp 兼容行为）
        return { type: "text", data: { text: encodeCqCode(code.type, code.params) } };
    }
    return builder(code.params);
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
