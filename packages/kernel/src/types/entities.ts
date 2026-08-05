/**
 * 实体类型层（运行时探测产物 + 公开资料作说明书，ADR-006）
 *
 * ⚠️ 部分字段按公开资料（NapCat 类型作说明书）自研描述，待下一次进程内
 * 探测（probe.ts）校准——接口签名是外部系统事实，自研描述其形状。
 */

/** 会话类型（QQ wrapper 外部契约）。 */
export const ChatType = {
    C2C: 1, // 私聊
    GROUP: 2, // 群聊
    DISC: 3, // 讨论组
    GUILD: 4, // 频道
    C2C_TEMP: 100, // 临时会话（群内私聊）
} as const;
export type ChatType = (typeof ChatType)[keyof typeof ChatType];

/** 会话对象（peer 目标：群号 / 用户 uid）。 */
export interface Peer {
    chatType: ChatType;
    peerUid: string;
    guildId?: string;
}

/** 消息元素（RawMessage.elements 成员，elementType + 子元素互斥）。 */
export interface RawElement {
    elementType: number;
    elementId?: string;
    [key: string]: unknown;
}

/** QQ 消息（RawMessage，说明书参考字段，探测后校准）。 */
export interface RawMessage {
    msgId: string; // 雪花 ID
    msgSeq: string; // 消息序列号
    msgTime: string; // 时间戳
    msgRandom?: string;
    msgType: number;
    chatType: ChatType;
    peerUid: string; // 群号 / 用户 uid
    peerUin: string; // 群号 / 用户 QQ 号
    senderUid: string;
    senderUin: string;
    peerName: string;
    sendNickName: string;
    sendMemberName?: string;
    elements: RawElement[];
    records?: RawMessage[];
    guildId?: string;
    [key: string]: unknown;
}
