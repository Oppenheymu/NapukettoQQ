/**
 * OneBot 11 消息事件（群聊 / 私聊）
 *
 * 群消息 sender 含 role（owner/admin/member）与 title（群头衔）；
 * 私聊消息 sub_type 区分好友/临时会话等来源。
 */

import type { OB11Message, Sender } from "../types/index.js";
import type { OB11BaseEvent } from "./base.js";

/** 匿名用户信息（群匿名消息，go-cqhttp 兼容）。 */
export interface Anonymous {
    id: number;
    name: string;
    flag: string;
}

/** 群消息发送者（role 必填 + 群头衔）。 */
export interface GroupSender extends Sender {
    role: "owner" | "admin" | "member";
    title?: string;
}

/** 群消息事件。 */
export interface OB11GroupMessageEvent extends OB11BaseEvent {
    post_type: "message";
    message_type: "group";
    /** 消息子类型：normal 普通 / anonymous 匿名 / notice 系统提示。 */
    sub_type: "normal" | "anonymous" | "notice";
    message_id: number;
    group_id: number;
    user_id: number;
    message: OB11Message;
    raw_message: string;
    font: number;
    sender: GroupSender;
    anonymous?: Anonymous;
}

/** 私聊消息事件。 */
export interface OB11PrivateMessageEvent extends OB11BaseEvent {
    post_type: "message";
    message_type: "private";
    /** 消息子类型：friend 好友 / group 临时会话 / other / self 自身。 */
    sub_type: "friend" | "group" | "other" | "self";
    message_id: number;
    user_id: number;
    message: OB11Message;
    raw_message: string;
    font: number;
    sender: Sender;
    /** 临时会话来源（0=未知，其他=来源群号）。 */
    temp_source?: number;
}

/** OB11 消息事件联合。 */
export type OB11MessageEvent = OB11GroupMessageEvent | OB11PrivateMessageEvent;
