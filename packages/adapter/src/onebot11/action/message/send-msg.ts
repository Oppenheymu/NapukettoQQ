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

import { type CanonicalElement, ChatType, kernelError, type Peer } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import { applySendContext, cqMessageToCanonical, segmentsToCanonical } from "../../helper/index.js";
import type { OB11MessageSegment } from "../../types/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const sendMsgSchema = z.object({
    message_type: z.enum(["group", "private"]).optional(),
    user_id: z.number().optional(),
    group_id: z.number().optional(),
    message: z.union([z.string(), z.array(z.unknown())]),
    auto_escape: z.boolean().optional(),
});

export type SendMsgPayload = z.infer<typeof sendMsgSchema>;

/** send_msg 依赖（OneBotApi 视图，由装配方注入）。 */
export type SendMsgDeps = Pick<OneBotApi, "msgApi" | "messageUnique" | "uinToUid">;

/** 解析目标 Peer（group_id 直通；user_id 经 uin→uid）。 */
async function resolvePeer(payload: SendMsgPayload, deps: SendMsgDeps): Promise<Peer> {
    if (payload.group_id !== undefined) {
        return { chatType: ChatType.GROUP, peerUid: String(payload.group_id) };
    }
    if (payload.user_id !== undefined) {
        const uidMap = await deps.uinToUid([String(payload.user_id)]);
        const uid = uidMap.get(String(payload.user_id));
        if (uid === undefined) {
            // 2026-08-07：抛类型化 KernelError（INVALID_PARAM=105），
            // 此前普通 Error → retcode 999（UNKNOWN）
            throw kernelError(`用户 ${payload.user_id} 的 uid 解析失败`, "INVALID_PARAM");
        }
        return { chatType: ChatType.C2C, peerUid: uid };
    }
    throw kernelError("send_msg 需要 group_id 或 user_id", "INVALID_PARAM");
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
    // P2-19 发送方向 ID 转换：at.qq 是 uin → uid（一次批量 uinToUid）；
    // reply.id 是 OB11 message_id → NT msgId（MessageUnique 反查，反查不到原样透传）
    const atUins: string[] = [];
    for (const el of canonical) {
        if (el.type === "at" && el.target !== "all") {
            atUins.push(el.target);
        }
    }
    let uinToUid: Map<string, string> | undefined;
    if (atUins.length > 0) {
        try {
            uinToUid = await deps.uinToUid(atUins);
        } catch {
            // uin 解析失败：at 原样（uin），交给 QQ 端判断
        }
    }
    canonical = applySendContext(canonical, {
        ...(uinToUid !== undefined ? { uinToUid } : {}),
        ob11IdToMsgId: (id) => deps.messageUnique.getMsgId(id),
    });
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
