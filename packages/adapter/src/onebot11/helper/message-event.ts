/**
 * OB11 消息事件翻译（RawMessage → OB11 消息事件，纯函数，ADR-008）
 *
 * 与 message-info.ts 的 toOb11MessageInfo（get_msg/历史消息返回结构）是两套格式：
 * 事件带 self_id/post_type/message_id；信息结构用于动作返回。
 */
import type { RawMessage } from "@napuketto/kernel";
import { ChatType, toCanonicalElements } from "@napuketto/kernel";
import type {
    OB11GroupMessageEvent,
    OB11MessageEvent,
    OB11PrivateMessageEvent,
} from "../event/index.js";
import type { GroupSender } from "../event/message.js";
import type { Sender } from "../types/index.js";
import { canonicalToCqMessage, canonicalToSegments } from "./data.js";
import type { MessageUnique } from "./message-unique.js";

/** 毫秒 → 秒（Unix 时间戳）。 */
const MS_TO_SEC = 1000;

/** RawMessage → OB11 消息事件（message_id 经 MessageUnique 映射并记录 peer）。 */
export function toOb11MessageEvent(
    msg: RawMessage,
    selfUin: string,
    unique: MessageUnique,
): OB11MessageEvent {
    const elements = toCanonicalElements(msg);
    const segments = canonicalToSegments(elements);
    const time = Math.floor(Number(msg.msgTime) / MS_TO_SEC);
    const selfId = Number(selfUin);
    const userId = Number(msg.senderUin);
    // 记录 peer：delete_msg / get_msg 等只有 message_id 的动作可反查
    const messageId = unique.alloc(msg.msgId, {
        chatType: msg.chatType,
        peerUid: msg.peerUid,
    });
    const base = {
        time,
        self_id: selfId,
        post_type: "message" as const,
        message_id: messageId,
        message: segments,
        raw_message: canonicalToCqMessage(elements),
        font: 0,
    };

    if (msg.chatType === ChatType.GROUP) {
        const sender: GroupSender = {
            user_id: userId,
            nickname: msg.sendNickName,
            role: "member", // P2-3: 接 kernel cache 判定 owner/admin
        };
        if (msg.sendMemberName !== undefined) {
            sender.card = msg.sendMemberName;
        }
        const event: OB11GroupMessageEvent = {
            ...base,
            message_type: "group",
            sub_type: "normal",
            group_id: Number(msg.peerUid),
            user_id: userId,
            sender,
        };
        return event;
    }

    // 私聊：C2C=好友，临时会话（群内私聊）sub_type=group
    let subType: "friend" | "group" = "friend";
    if (msg.chatType === ChatType.C2C_TEMP) {
        subType = "group";
    }
    const sender: Sender = {
        user_id: userId,
        nickname: msg.sendNickName,
    };
    const event: OB11PrivateMessageEvent = {
        ...base,
        message_type: "private",
        sub_type: subType,
        user_id: userId,
        sender,
    };
    return event;
}
