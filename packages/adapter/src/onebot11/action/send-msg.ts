/**
 * send_msg 动作：发送消息（群聊/私聊）+ 共享发送核心 sendOb11Message
 *
 * P2-3 真实化：注入 kernel MsgApi，message 参数（CQ 码字符串或 segment 数组）
 * 翻译为 canonical 元素 → MsgApi.sendMessage → 返回真实 message_id。
 * send_private_msg / send_group_msg 复用 sendOb11Message（P2-10）。
 *
 * 群聊：group_id → Peer{ chatType: GROUP, peerUid: String(group_id) }（群消息 peerUid=群号）。
 * 私聊：user_id 经 uin→uid → Peer{ chatType: C2C, peerUid: uid }。
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

export type SendMsgPayload = z.infer<typeof sendMsgSchema>;

/** send_msg 依赖（由装配方注入）。 */
export interface SendMsgDeps {
    msgApi: MsgApi;
    messageUnique: MessageUnique;
    /** uin→uid 转换（私聊发送需要）。 */
    uinToUid: (uins: string[]) => Promise<Map<string, string>>;
}

/** 解析目标 Peer（group_id 直通；user_id 经 uin→uid）。 */
async function resolvePeer(payload: SendMsgPayload, deps: SendMsgDeps): Promise<Peer> {
    if (payload.group_id !== undefined) {
        return { chatType: ChatType.GROUP, peerUid: String(payload.group_id) };
    }
    if (payload.user_id !== undefined) {
        const uidMap = await deps.uinToUid([String(payload.user_id)]);
        const uid = uidMap.get(String(payload.user_id));
        if (uid === undefined) {
            throw new Error(`用户 ${payload.user_id} 的 uid 解析失败`);
        }
        return { chatType: ChatType.C2C, peerUid: uid };
    }
    throw new Error("send_msg 需要 group_id 或 user_id");
}

/** 共享发送核心：解析 Peer → canonical 翻译（含 auto_escape）→ sendMessage → 映射 message_id。 */
export async function sendOb11Message(
    payload: SendMsgPayload,
    deps: SendMsgDeps,
): Promise<{ message_id: number }> {
    const peer = await resolvePeer(payload, deps);
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
    const { msgId } = await deps.msgApi.sendMessage(peer, canonical);
    return { message_id: deps.messageUnique.alloc(msgId, peer) };
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

    protected _handle(payload: SendMsgPayload): Promise<{ message_id: number }> {
        return sendOb11Message(payload, this.deps);
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
