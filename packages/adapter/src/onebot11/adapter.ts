/**
 * NapukettoOneBot11Adapter：OneBot 11 协议适配器（P2-3：收发闭环）
 *
 * - 收链路：订阅 kernel 消息事件通道 → RawMessage 翻译 OB11 消息事件 → network 广播
 * - 发链路：handleRequest（OB11 标准 { action, params, echo }）→ 动作注册表 → kernel apis
 *
 * 生命周期走 BaseProtocolAdapter 骨架（start 校验配置 → onStart 订阅 → stop 退订）。
 * 翻译为纯函数（ADR-008）：只读入参（RawMessage），不调 API、不读缓存。
 */

import type { FriendApi, GroupApi, MsgApi, MsgEventChannel, RawMessage } from "@napuketto/kernel";
import { ChatType, toCanonicalElements } from "@napuketto/kernel";
import type { EventBroadcaster } from "@napuketto/network";
import {
    type ActionRegistry,
    type ActionResult,
    BaseProtocolAdapter,
    type ProtocolConfig,
} from "../core/index.js";
import { createOb11ActionRegistry } from "./action/index.js";
import type {
    OB11GroupMessageEvent,
    OB11MessageEvent,
    OB11PrivateMessageEvent,
} from "./event/index.js";
import type { GroupSender } from "./event/message.js";
import type { OB11Config } from "./helper/index.js";
import { canonicalToCqMessage, canonicalToSegments, ob11ConfigSchema } from "./helper/index.js";
import { MessageUnique } from "./helper/message-unique.js";
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
    /** kernel 消息 API（send_msg 等动作用）。 */
    msgApi: MsgApi;
    /** kernel 群 API（查询动作用）。 */
    groupApi: GroupApi;
    /** kernel 好友 API（get_friend_list 用）。 */
    friendApi: FriendApi;
    /** 机器人自身 QQ 号（self_id 与私聊自消息判定）。 */
    selfUin: string;
    /** 机器人昵称（get_login_info 用，缺省空）。 */
    selfNickname?: string;
}

/** RawMessage → OB11 消息事件（纯函数，ADR-008）。 */
function toOb11MessageEvent(
    msg: RawMessage,
    selfUin: string,
    unique: MessageUnique,
): OB11MessageEvent {
    const elements = toCanonicalElements(msg);
    const segments = canonicalToSegments(elements);
    const time = Math.floor(Number(msg.msgTime) / MS_TO_SEC);
    const selfId = Number(selfUin);
    const userId = Number(msg.senderUin);
    const messageId = unique.alloc(msg.msgId);
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
    private readonly messageUnique = new MessageUnique();
    private readonly registry: ActionRegistry;
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
        this.registry = createOb11ActionRegistry({
            sendMsg: {
                msgApi: opts.msgApi,
                messageUnique: this.messageUnique,
                uinToUid: (uins) => opts.groupApi.uinToUid(uins),
            },
            groupApi: opts.groupApi,
            friendApi: opts.friendApi,
            self: { uin: opts.selfUin, nickname: opts.selfNickname ?? "" },
        });
    }

    /** 订阅 kernel 消息事件（幂等）。 */
    private subscribe(): void {
        if (this.unsubscribe !== null) {
            return;
        }
        this.unsubscribe = this.msgChannel.on("Msg/onRecvMsg", (msg) => {
            this.broadcastEvent(toOb11MessageEvent(msg, this.selfUin, this.messageUnique));
        });
    }

    /** 退订（幂等）。 */
    private unsubscribeAll(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    /**
     * 请求分发（挂到 network transport 的 onRequest）：
     * OB11 标准请求 { action, params, echo } → 动作注册表 → handle（HTTP）/websocketHandle（WS）。
     */
    async handleRequest(req: unknown, respond: (res: unknown) => void): Promise<void> {
        const parsed = (req ?? {}) as { action?: unknown; params?: unknown; echo?: unknown };
        const { action: rawAction, params, echo } = parsed;
        let action = "";
        if (typeof rawAction === "string") {
            action = rawAction;
        }
        if (action === "") {
            respond({
                status: "failed",
                retcode: 404,
                data: null,
                message: "请求缺少 action",
            });
            return;
        }
        const act = this.registry.get(action);
        if (act === undefined) {
            respond({
                status: "failed",
                retcode: 404,
                data: null,
                message: `未知动作: ${action}`,
            });
            return;
        }
        let result: ActionResult<unknown>;
        if (echo === undefined) {
            result = await act.handle(params);
        } else {
            result = await act.websocketHandle(params, echo);
        }
        respond(result);
    }
}
