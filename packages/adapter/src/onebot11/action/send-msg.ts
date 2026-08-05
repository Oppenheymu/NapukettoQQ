/**
 * send_msg 动作：发送消息（群聊/私聊）
 *
 * P2-3 真实化：注入 kernel MsgApi，message 参数（CQ 码字符串或 segment 数组）
 * 翻译为 canonical 元素 → MsgApi.sendMessage → 返回真实 message_id。
 *
 * 群聊：group_id → Peer{ chatType: GROUP, peerUid: String(group_id) }（群消息 peerUid=群号）。
 * 私聊：user_id 需 uin→uid（BuddyService 探测后 P2-4 补），暂明确 reject。
 */

import { type CanonicalElement, ChatType, type MsgApi, type Peer } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import { cqMessageToCanonical, segmentsToCanonical } from "../helper/index.js";
import type { MessageUnique } from "../helper/message-unique.js";
import type { OB11MessageSegment } from "../types/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const sendMsgSchema = z.object({
    message_type: z.enum(["group", "private"]).optional(),
    user_id: z.number().optional(),
    group_id: z.number().optional(),
    message: z.union([z.string(), z.array(z.unknown())]),
    auto_escape: z.boolean().optional(),
});

type SendMsgPayload = z.infer<typeof sendMsgSchema>;

/** send_msg 依赖（由装配方注入）。 */
export interface SendMsgDeps {
    msgApi: MsgApi;
    messageUnique: MessageUnique;
}

/** 解析目标 Peer（group_id 直通；user_id 私聊待 uin→uid）。 */
function resolvePeer(payload: SendMsgPayload): Peer {
    if (payload.group_id !== undefined) {
        return { chatType: ChatType.GROUP, peerUid: String(payload.group_id) };
    }
    // TODO(P2-4): BuddyService uin→uid 探测后补私聊发送
    throw new Error("send_msg 私聊（user_id）暂不支持：uin→uid 映射 P2-4 接入");
}

/** 发送消息（P2-3 接 kernel apis/msg，返回真实 message_id）。 */
export class SendMsgAction extends BaseAction<SendMsgPayload, { message_id: number }> {
    readonly name = "send_msg";
    readonly schema = sendMsgSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: SendMsgDeps;

    constructor(deps: SendMsgDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: SendMsgPayload): Promise<{ message_id: number }> {
        if (payload.group_id === undefined && payload.user_id === undefined) {
            throw new Error("send_msg 需要 group_id 或 user_id");
        }
        const peer = resolvePeer(payload);
        // message: CQ 码字符串 → canonical；segment 数组 → canonical
        let canonical: CanonicalElement[];
        if (Array.isArray(payload.message)) {
            canonical = segmentsToCanonical(payload.message as OB11MessageSegment[]);
        } else {
            canonical = cqMessageToCanonical(payload.message);
        }
        // auto_escape：文本段转义 CQ 特殊字符
        if (payload.auto_escape === true) {
            canonical = canonical.map((el) => {
                if (el.type === "text") {
                    return { ...el, text: escapeText(el.text) };
                }
                return el;
            });
        }
        const { msgId } = await this.deps.msgApi.sendMessage(peer, canonical);
        return { message_id: this.deps.messageUnique.alloc(msgId) };
    }
}

/** CQ 特殊字符转义（auto_escape，&、[、]、, 前置 &amp;）。 */
function escapeText(text: string): string {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("[", "&#91;")
        .replaceAll("]", "&#93;")
        .replaceAll(",", "&#44;");
}
