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

/** 文本元素（at 用 atType + atUid 表达）。 */
export interface TextElement {
    content: string;
    atType?: number; // 1=全体 2=单人 4=我
    atUid?: string;
}

/** 图片元素（发送时 picPath 必须；接收含 url）。 */
export interface PicElement {
    picPath?: string;
    picUrl?: string;
    picType?: number;
    picWidth?: number;
    picHeight?: number;
    md5?: string;
    fileName?: string;
    sourcePath?: string;
    thumbPath?: string;
}

/** 语音元素（silk）。 */
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
    replayMsgSeq?: string;
    replayMsgTime?: string;
    senderUid?: string;
    senderUin?: string;
}

/** 视频元素。 */
export interface VideoElement {
    filePath?: string;
    videoUrl?: string;
    fileName?: string;
    fileSize?: string;
}

/** 文件元素。 */
export interface FileElement {
    filePath?: string;
    fileName?: string;
    fileSize?: string;
    fileUuid?: string;
}

/** 消息元素（RawMessage.elements 成员，elementType + 子元素互斥）。 */
export interface RawElement {
    elementType: number;
    elementId?: string;
    textElement?: TextElement;
    picElement?: PicElement;
    pttElement?: PttElement;
    faceElement?: FaceElement;
    replyElement?: ReplyElement;
    videoElement?: VideoElement;
    fileElement?: FileElement;
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
