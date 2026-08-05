/**
 * NapukettoOneBot11Adapter：OneBot 11 协议适配器（P2-3：收发闭环）
 *
 * - 收链路：订阅 kernel 消息事件通道 → RawMessage 翻译 OB11 消息事件 → network 广播
 * - 发链路：handleRequest（OB11 标准 { action, params, echo }）→ 动作注册表 → kernel apis
 *
 * 生命周期走 BaseProtocolAdapter 骨架（start 校验配置 → onStart 订阅 → stop 退订）。
 * 翻译为纯函数（ADR-008）：只读入参（RawMessage），不调 API、不读缓存。
 */

import type {
    FriendApi,
    GroupApi,
    GroupNotifyApi,
    MsgApi,
    MsgEventChannel,
    ProfileApi,
    ProfileLikeApi,
    RawMessage,
    RichMediaApi,
    TicketApi,
    WebApi,
} from "@napuketto/kernel";
import type { EventBroadcaster } from "@napuketto/network";
import {
    type ActionRegistry,
    type ActionResult,
    BaseProtocolAdapter,
    type ProtocolConfig,
} from "../core/index.js";
import { createOb11ActionRegistry } from "./action/index.js";
import type { OB11Config } from "./helper/index.js";
import { ob11ConfigSchema } from "./helper/index.js";
import { toOb11MessageEvent } from "./helper/message-event.js";
import { MessageUnique } from "./helper/message-unique.js";
import { collectGrayTipUids, hasGrayTip, toOb11NoticeEvent } from "./helper/notice.js";
import type { Ob11TransportSet } from "./transport.js";
import { assembleOb11Transports } from "./transport.js";

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
    /** kernel 群通知 API（群请求/禁言列表用，P2-13）。 */
    groupNotifyApi: GroupNotifyApi;
    /** kernel 票据 API（get_clientkey/get_cookies 用，P2-13）。 */
    ticketApi: TicketApi;
    /** kernel 富媒体 API（群文件/翻译用，P2-14）。 */
    richMediaApi: RichMediaApi;
    /** kernel 资料 API（签名/昵称/头像用，P2-14）。 */
    profileApi: ProfileApi;
    /** kernel 点赞 API（send_like 用，P2-14）。 */
    profileLikeApi: ProfileLikeApi;
    /** kernel 群空间 web API（精华/荣誉用，P2-15）。 */
    webApi: WebApi;
    /** 机器人自身 QQ 号（self_id 与私聊自消息判定）。 */
    selfUin: string;
    /** 机器人昵称（get_login_info 用，缺省空）。 */
    selfNickname?: string;
    /** 运行版本（get_version_info 用，缺省 unknown）。 */
    appVersion?: string;
    /** 缓存清理回调（clean_cache 用，装配方注入）。 */
    cleanCache?: () => Promise<void>;
    /** 缓存目录（download_file 保存路径，装配方注入）。 */
    cacheDir?: string;
    /** 进程退出回调（bot_exit 用，装配方注入）。 */
    exit?: () => Promise<void>;
    /** 进程重启回调（set_restart 用，装配方注入）。 */
    restart?: () => Promise<void>;
}

/** OneBot 11 协议适配器。 */
export class NapukettoOneBot11Adapter extends BaseProtocolAdapter<OB11Config> {
    readonly protocol = "onebot11";
    readonly configSchema = ob11ConfigSchema;

    private readonly msgChannel: MsgEventChannel;
    private readonly selfUin: string;
    private readonly groupApi: GroupApi;
    private readonly messageUnique = new MessageUnique();
    private readonly registry: ActionRegistry;
    private unsubscribe: (() => void) | null = null;
    private transports: Ob11TransportSet | null = null;
    private heartbeatTimer: NodeJS.Timeout | null = null;

    constructor(opts: OneBot11AdapterOptions) {
        super({
            config: opts.config,
            broadcaster: opts.broadcaster,
            hooks: {
                onStart: (config) => this.startTransports(config as OB11Config),
                onStop: () => this.stopAll(),
                onReload: () => {
                    // P2-6：配置热更新重建传输
                    return Promise.resolve();
                },
            },
        });
        this.msgChannel = opts.msgChannel;
        this.selfUin = opts.selfUin;
        this.groupApi = opts.groupApi;
        const system: {
            appVersion: string;
            cleanCache?: () => Promise<void>;
            cacheDir?: string;
            exit?: () => Promise<void>;
            restart?: () => Promise<void>;
        } = {
            appVersion: opts.appVersion ?? "unknown",
        };
        if (opts.cleanCache !== undefined) {
            system.cleanCache = opts.cleanCache;
        }
        if (opts.cacheDir !== undefined) {
            system.cacheDir = opts.cacheDir;
        }
        if (opts.exit !== undefined) {
            system.exit = opts.exit;
        }
        if (opts.restart !== undefined) {
            system.restart = opts.restart;
        }
        this.registry = createOb11ActionRegistry({
            sendMsg: {
                msgApi: opts.msgApi,
                messageUnique: this.messageUnique,
                uinToUid: (uins) => opts.groupApi.uinToUid(uins),
            },
            groupApi: opts.groupApi,
            groupNotifyApi: opts.groupNotifyApi,
            friendApi: opts.friendApi,
            ticketApi: opts.ticketApi,
            richMediaApi: opts.richMediaApi,
            profileApi: opts.profileApi,
            profileLikeApi: opts.profileLikeApi,
            webApi: opts.webApi,
            self: { uin: opts.selfUin, nickname: opts.selfNickname ?? "" },
            system,
        });
    }

    /** 启动传输：装配（HTTP/WS）+ 打开 server/client + 广播 lifecycle enable + 起心跳。 */
    private async startTransports(config: OB11Config): Promise<void> {
        const broadcaster = this.getBroadcaster();
        if (broadcaster !== undefined) {
            this.transports = assembleOb11Transports({
                config,
                broadcaster,
                handleRequest: (req, respond) => {
                    this.handleRequest(req, respond).catch((err: unknown) => {
                        let message = String(err);
                        if (err instanceof Error) {
                            // biome-ignore lint/style/useDestructuring: err 为 unknown 运行时窄化，解构不适用
                            message = err.message;
                        }
                        respond({ status: "failed", retcode: 999, data: null, message });
                    });
                },
            });
            // 打开 server + 正向 client
            await Promise.all(this.transports.servers.map((s) => s.open()));
            await Promise.all(this.transports.transports.map((t) => t.open()));
        }
        this.subscribe();
        // lifecycle: enable
        this.broadcastEvent({
            time: Math.floor(Date.now() / MS_TO_SEC),
            self_id: Number(this.selfUin),
            post_type: "meta_event",
            meta_event_type: "lifecycle",
            sub_type: "enable",
        });
        // 心跳
        this.startHeartbeat(config.heartbeatInterval);
    }

    /** 心跳 meta 事件（interval 毫秒，0 关闭）。 */
    private startHeartbeat(intervalMs: number): void {
        if (intervalMs <= 0) {
            return;
        }
        this.heartbeatTimer = setInterval(() => {
            this.broadcastEvent({
                time: Math.floor(Date.now() / MS_TO_SEC),
                self_id: Number(this.selfUin),
                post_type: "meta_event",
                meta_event_type: "heartbeat",
                interval: intervalMs,
                status: { online: true, good: true },
            });
        }, intervalMs);
    }

    /** 停止：心跳 + 传输 + 退订。 */
    private async stopAll(): Promise<void> {
        if (this.heartbeatTimer !== null) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        this.unsubscribeAll();
        if (this.transports !== null) {
            await this.transports.close();
            this.transports = null;
        }
    }

    /** 订阅 kernel 消息事件（幂等）。 */
    private subscribe(): void {
        if (this.unsubscribe !== null) {
            return;
        }
        this.unsubscribe = this.msgChannel.on("Msg/onRecvMsg", (msg) => {
            // grayTip（系统事件）→ notice；否则 → 消息事件
            if (hasGrayTip(msg)) {
                this.broadcastNotice(msg).catch(() => {
                    // notice 翻译失败静默（grayTip 解析宽容）
                });
                return;
            }
            this.broadcastEvent(toOb11MessageEvent(msg, this.selfUin, this.messageUnique));
        });
    }

    /** 广播 grayTip → notice 事件（批量 uidToUin 后翻译，纯函数）。 */
    private async broadcastNotice(msg: RawMessage): Promise<void> {
        const uids = collectGrayTipUids(msg);
        let uidToUin = new Map<string, string>();
        if (uids.length > 0) {
            uidToUin = await this.groupApi.uidToUin(uids);
        }
        const notice = toOb11NoticeEvent(msg, { selfUin: this.selfUin, uidToUin });
        if (notice !== null) {
            this.broadcastEvent(notice);
        }
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
