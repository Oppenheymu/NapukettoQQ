/**
 * Satori 事件与信令类型（协议 v1，规范参考 satori.chat/zh-CN/protocol/events.html）
 *
 * - Opcode：信令类型（EVENT=0 收 / PING=1 发 / PONG=2 收 / IDENTIFY=3 发 / READY=4 收 / META=5 收）
 * - Signal：信令外壳 { op, body }
 * - Event：事件对象（资源提升：message 不嵌套 user/member/channel，平铺顶层）
 */
import type {
    Channel,
    Emoji,
    Friend,
    Guild,
    GuildMember,
    GuildRole,
    Login,
    Message,
    User,
} from "./resource.js";

/** 信令类型。 */
export const Opcode = {
    EVENT: 0, // 接收：事件
    PING: 1, // 发送：心跳
    PONG: 2, // 接收：心跳回复
    IDENTIFY: 3, // 发送：鉴权
    READY: 4, // 接收：鉴权成功
    META: 5, // 接收：元信息更新（实验性）
} as const;
export type Opcode = (typeof Opcode)[keyof typeof Opcode];

/** 信令外壳。 */
export interface Signal<T = unknown> {
    op: Opcode;
    body?: T;
}

/** IDENTIFY 信令 body（鉴权 + 可选会话恢复）。 */
export interface IdentifyBody {
    token?: string;
    sn?: number;
}

/** READY 信令 body。 */
export interface ReadyBody {
    logins: Login[];
    proxy_urls: string[];
}

/** META 信令 body（不反映登录状态，不含 logins）。 */
export interface MetaBody {
    proxy_urls: string[];
}

/** 交互指令（interaction 事件）。 */
export interface Argv {
    name?: string;
    arguments?: string;
    options?: Record<string, string>;
}

/** 交互按钮。 */
export interface Button {
    id?: string;
}

/** 事件对象（type 为事件类型；各资源字段按规范可选）。 */
export interface Event {
    /** 事件序列号（会话内递增，1 起）。 */
    sn: number;
    /** 事件类型（message-created 等）。 */
    type: string;
    /** 事件时间戳（毫秒）。 */
    timestamp: number;
    /** 登录信息（非登录事件只带 sn/user/platform）。 */
    login: Login;
    /** 交互指令（button 等）。 */
    argv?: Argv;
    /** 交互按钮。 */
    button?: Button;
    /** 事件所属频道。 */
    channel?: Channel;
    /** 事件的表情（reaction 事件）。 */
    emoji?: Emoji;
    /** 事件的好友（friend 事件）。 */
    friend?: Friend;
    /** 事件所属群组。 */
    guild?: Guild;
    /** 事件的目标成员。 */
    member?: GuildMember;
    /** 事件的消息。 */
    message?: Message;
    /** 事件的操作者。 */
    operator?: User;
    /** 事件的目标角色。 */
    role?: GuildRole;
    /** 事件的目标用户。 */
    user?: User;
}
