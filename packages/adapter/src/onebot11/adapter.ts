/**
 * NapukettoOneBot11Adapter：OneBot 11 协议适配器（消息收链路，P2-2）
 *
 * 职责：订阅 kernel 消息事件通道（MsgBridge 持有）→ RawMessage 翻译成
 * OB11 消息事件 → network 广播。生命周期走 BaseProtocolAdapter 骨架
 * （start 校验配置 → onStart 订阅 → stop 退订）。
 *
 * 翻译为纯函数（ADR-008）：只读入参（RawMessage），不调 API、不读缓存。
 * 请求分发（动作注册表 → kernel apis）在 P2-3 接入。
 */

import type { MsgEventChannel, RawMessage } from "@napuketto/kernel";
import { ChatType, toCanonicalElements } from "@napuketto/kernel";
import type { EventBroadcaster } from "@napuketto/network";
import { BaseProtocolAdapter, type ProtocolConfig } from "../core/index.js";
import type {
    OB11GroupMessageEvent,
    OB11MessageEvent,
    OB11PrivateMessageEvent,
} from "./event/index.js";
import type { GroupSender } from "./event/message.js";
import type { OB11Config } from "./helper/index.js";
import { canonicalToCqMessage, canonicalToSegments, ob11ConfigSchema } from "./helper/index.js";
import type { Sender } from "./types/index.js";

/** 毫秒 → 秒（Unix 时间戳）。 */
const MS_TO_SEC = 1000;

/** 适配器构造参数。 */
export interface OneBot11AdapterOptions {
    /** 协议配置（zod 校验 + JSON 读写）。 */
    config: ProtocolConfig<OB11Config>;
    /** network 事件广播（注册传输适配器后 emit 推给第三方）。 */
    broadcaster: EventBroadcaster;
    /** kernel 消息事件通道（消息收链路入口）。 */
    msgChannel: MsgEventChannel;
    /** 机器人自身 QQ 号（self_id 与私聊自消息判定）。 */
    selfUin: string;
}

/** RawMessage → OB11 消息事件（纯函数，ADR-008）。 */
function toOb11MessageEvent(msg: RawMessage, selfUin: string): OB11MessageEvent {
    const elements = toCanonicalElements(msg);
    const segments = canonicalToSegments(elements);
    const time = Math.floor(Number(msg.msgTime) / MS_TO_SEC);
    const selfId = Number(selfUin);
    const userId = Number(msg.senderUin);
    // TODO(P2-3): MessageUnique——雪花 msgId → int32 稳定映射（当前用 msgSeq 近似）
    const messageId = Number(msg.msgSeq);
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

/** OneBot 11 协议适配器。 */
export class NapukettoOneBot11Adapter extends BaseProtocolAdapter<OB11Config> {
    readonly protocol = "onebot11";
    readonly configSchema = ob11ConfigSchema;

    private readonly msgChannel: MsgEventChannel;
    private readonly selfUin: string;
    private unsubscribe: (() => void) | null = null;

    constructor(opts: OneBot11AdapterOptions) {
        super({
            config: opts.config,
            broadcaster: opts.broadcaster,
            hooks: {
                onStart: () => {
                    this.subscribe();
                    return Promise.resolve();
                },
                onStop: () => {
                    this.unsubscribeAll();
                    return Promise.resolve();
                },
                onReload: () => {
                    // 事件订阅无配置依赖，重载无需重建
                    return Promise.resolve();
                },
            },
        });
        this.msgChannel = opts.msgChannel;
        this.selfUin = opts.selfUin;
    }

    /** 订阅 kernel 消息事件（幂等）。 */
    private subscribe(): void {
        if (this.unsubscribe !== null) {
            return;
        }
        this.unsubscribe = this.msgChannel.on("Msg/onRecvMsg", (msg) => {
            this.broadcastEvent(toOb11MessageEvent(msg, this.selfUin));
        });
    }

    /** 退订（幂等）。 */
    private unsubscribeAll(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }
}
