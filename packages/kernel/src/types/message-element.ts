/**
 * canonical 消息元素模型（协议无关，ADR-008 延伸）
 *
 * 描述 QQ 消息的事实结构，是各协议翻译层的公共中间表示：
 * kernel 只做一次 NT ↔ canonical（toCanonicalElements / toSendElements），
 * 各协议（onebot11/onebot12/satori）只写薄映射 canonical ↔ 协议格式。
 */

import { kernelError } from "../errors.js";
import type { RawMessage } from "./entities.js";
import { ElementType, type SendMessageElement } from "./services/msg-service.js";

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
    // TODO(P2-2): 等 scripts/probe 产出 RawElement 字段后实现映射
    return [];
}

/** canonical 元素 → NT 发送元素（text/at/face/image/voice/reply 核心五类）。 */
export function toSendElements(elements: CanonicalElement[]): SendMessageElement[] {
    const out: SendMessageElement[] = [];
    for (const el of elements) {
        switch (el.type) {
            case "text":
                out.push({ elementType: ElementType.TEXT, textElement: { content: el.text } });
                break;
            case "at":
                if (el.target === "all") {
                    out.push({
                        elementType: ElementType.TEXT,
                        textElement: { content: el.display ?? "@", atType: 1 },
                    });
                } else {
                    out.push({
                        elementType: ElementType.TEXT,
                        textElement: { content: el.display ?? "@", atType: 2, atUid: el.target },
                    });
                }
                break;
            case "face":
                out.push({
                    elementType: ElementType.FACE,
                    faceElement: { faceIndex: Number(el.id) },
                });
                break;
            case "image":
                out.push({ elementType: ElementType.PIC, picElement: { picPath: el.path } });
                break;
            case "voice":
                out.push({ elementType: ElementType.PTT, pttElement: { filePath: el.path } });
                break;
            case "reply":
                out.push({
                    elementType: ElementType.REPLY,
                    replyElement: {
                        replayMsgId: el.messageId,
                        replayMsgSeq: el.messageId,
                        replayMsgTime: "0",
                    },
                });
                break;
            case "video":
            case "file":
            case "forward":
            case "json":
            case "xml":
            case "unknown":
                throw kernelError(`发送元素 ${el.type} 暂不支持（P2-2 探测后补）`, "INVALID_PARAM");
            default:
                // exhaustive：CanonicalElement 无其他成员
                break;
        }
    }
    return out;
}
