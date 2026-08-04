/**
 * canonical 消息元素模型（协议无关，ADR-008 延伸）
 *
 * 描述 QQ 消息的事实结构，是各协议翻译层的公共中间表示：
 * kernel 只做一次 NT ↔ canonical（toCanonicalElements / toSendElements），
 * 各协议（onebot11/onebot12/satori）只写薄映射 canonical ↔ 协议格式。
 */

import type { RawMessage } from "./entities.js";

/** 协议无关的规范消息元素。 */
export type CanonicalElement =
    | { type: "text"; text: string }
    | { type: "at"; target: string; display?: string }
    | { type: "image"; path: string; url?: string; size?: { width: number; height: number } }
    | { type: "face"; id: string }
    | { type: "voice"; path: string; durationMs?: number; url?: string }
    | { type: "video"; path: string; url?: string }
    | { type: "file"; path: string; name?: string; size?: number }
    | { type: "reply"; messageId: string }
    | { type: "forward"; messageIds: string[] }
    | { type: "json"; raw: unknown }
    | { type: "xml"; raw: unknown }
    | { type: "unknown"; raw: unknown };

/** NT RawMessage → canonical 元素（P1 探测 RawElement 真实结构后实现，ADR-006）。 */
export function toCanonicalElements(_msg: RawMessage): CanonicalElement[] {
    // TODO(P1): 等 scripts/probe 产出 RawElement 字段后实现映射
    return [];
}

/** canonical 元素 → NT 发送元素（P1 探测 SendMessageElement 结构后实现）。 */
export function toSendElements(_elements: CanonicalElement[]): unknown[] {
    // TODO(P1): 等 scripts/probe 产出 SendMessageElement 结构后实现
    return [];
}
