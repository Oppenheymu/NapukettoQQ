/**
 * NodeIKernelMsgService：消息服务接口面（自研描述，非移植）
 *
 * 依据：getMsgService() 运行时反射 + NapCat 公开类型作「说明书」理解 QQ wrapper
 * 契约（接口签名是外部系统的事实，我们自研描述其形状，零复制实现）。
 * 只收录 apis/msg 当前需要的方法；其余 200+ 方法按需探测后补齐。
 */
import type { Peer, RawMessage } from "../entities.js";

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

/** 文本元素（at 用 atType + atUid 表达）。 */
export interface TextElement {
    content: string;
    atType?: number; // 1=全体 2=单人 4=我
    atUid?: string;
}

/** 图片元素（发送时 picPath 必须）。 */
export interface PicElement {
    picPath: string;
    picType?: number;
    picWidth?: number;
    picHeight?: number;
    md5?: string;
    fileName?: string;
    sourcePath?: string;
    thumbPath?: string;
}

/** 语音元素（silk，filePath 必须）。 */
export interface PttElement {
    filePath?: string;
    md5?: string;
    fileName?: string;
    duration?: number;
}

/** 表情元素。 */
export interface FaceElement {
    faceIndex: number;
    faceType?: number;
}

/** 回复元素（引用消息）。 */
export interface ReplyElement {
    replayMsgId: string;
    replayMsgSeq: string;
    replayMsgTime: string;
    senderUid?: string;
    senderUin?: string;
}

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
    setMsgRead(peer: Peer): Promise<GeneralCallResult>;
}
