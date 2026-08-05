/**
 * NodeIKernelMsgService：消息服务接口面（自研描述，非移植）
 *
 * 依据：getMsgService() 运行时反射 + NapCat 公开类型作「说明书」理解 QQ wrapper
 * 契约（接口签名是外部系统的事实，我们自研描述其形状，零复制实现）。
 * 只收录 apis/msg 当前需要的方法；其余 200+ 方法按需探测后补齐。
 */
import type {
    FaceElement,
    Peer,
    PicElement,
    PttElement,
    RawMessage,
    ReplyElement,
    TextElement,
} from "../entities.js";

/** 原生通用返回：result 非 0 即失败（errMsg 附原因）。 */
export interface GeneralCallResult {
    result: number;
    errMsg: string;
}

/** 消息元素类型枚举（QQ wrapper 外部契约，自研描述）。 */
export const ElementType = {
    UNKNOWN: 0,
    TEXT: 1,
    PIC: 2,
    FILE: 3,
    PTT: 4,
    VIDEO: 5,
    FACE: 6,
    REPLY: 7,
    GRAY_TIP: 8,
    WALLET: 9,
    ARK: 10,
    MFACE: 11,
    LIVE_GIFT: 12,
    STRUCT_LONG_MSG: 13,
    MARKDOWN: 14,
    GIPHY: 15,
    MULTI_FORWARD: 16,
    INLINE_KEYBOARD: 17,
    INTEXT_GIFT: 18,
    CALENDAR: 19,
} as const;
export type ElementType = (typeof ElementType)[keyof typeof ElementType];

/** 发送消息元素（session 发送用，elementType + 各子元素互斥）。 */
export interface SendMessageElement {
    elementType: ElementType;
    elementId?: string;
    textElement?: TextElement;
    faceElement?: FaceElement;
    replyElement?: ReplyElement;
    picElement?: PicElement;
    pttElement?: PttElement;
}

/** 消息服务：apis/msg 用到的核心方法面。 */
export interface NodeIKernelMsgService {
    addKernelMsgListener(listener: unknown): number;
    removeKernelMsgListener(listenerId: number): void;
    generateMsgUniqueId(chatType: number, time: string): string;
    sendMsg(
        msgId: string,
        peer: Peer,
        elements: SendMessageElement[],
        map: Map<number, unknown>,
    ): Promise<GeneralCallResult>;
    recallMsg(peer: Peer, msgIds: string[]): Promise<GeneralCallResult>;
    getMsgs(
        peer: Peer,
        msgId: string,
        count: number,
        queryOrder: boolean,
    ): Promise<GeneralCallResult & { msgList?: RawMessage[] }>;
    /** 按 msgId 批量拉取消息（get_msg / 精华消息 / ptt 转文字共用）。 */
    getMsgsByMsgId(
        peer: Peer,
        ids: string[],
    ): Promise<GeneralCallResult & { msgList?: RawMessage[] }>;
    setMsgRead(peer: Peer): Promise<GeneralCallResult>;
    /** 消息表情表态（set_msg_emoji_like；setOrCancel=true 点赞，false 取消）。 */
    setMsgEmojiLikes(
        peer: Peer,
        msgSeq: string,
        emojiId: string,
        emojiType: string,
        setOrCancel: boolean,
    ): Promise<GeneralCallResult>;
    /** 语音转文字（fetch_ptt_text；异步转写，结果写回 pttElement.text）。 */
    translatePtt2Text(msgId: string, peer: Peer, msgElement: unknown): Promise<GeneralCallResult>;
}
