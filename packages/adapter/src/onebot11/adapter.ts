/**
 * NapukettoOneBot11Adapter：OneBot 11 协议适配器（P2-3：收发闭环）
 *
 * - 收链路：订阅 kernel 消息事件通道 → RawMessage 翻译 OB11 消息事件 → network 广播
 * - 发链路：handleRequest（OB11 标准 { action, params, echo }）→ 动作注册表 → kernel apis
 *
 * 生命周期走 BaseProtocolAdapter 骨架（start 校验配置 → onStart 订阅 → stop 退订）。
 * 翻译为纯函数（ADR-008）：只读入参（RawMessage），不调 API、不读缓存。
 */

import type { MsgEventChannel, RawMessage } from "@napuketto/kernel";
import { toCanonicalElements } from "@napuketto/kernel";
import type { EventBroadcaster } from "@napuketto/network";
import {
    type ActionRegistry,
    type ActionResult,
    BaseProtocolAdapter,
    type ProtocolConfig,
} from "../core/index.js";
import { forEachRawMessage } from "../core/raw-message.js";
import { createOb11ActionRegistry } from "./action/index.js";
import type { OneBotApiOptions } from "./api/index.js";
import { OneBotApi } from "./api/index.js";
import type { OB11Config } from "./helper/index.js";
import { collectReceiveNeeds, type ReceiveTranslateContext } from "./helper/index.js";
import { toOb11MessageEvent } from "./helper/message-event.js";
import { collectGrayTipUids, hasGrayTip, toOb11NoticeEvent } from "./helper/notice.js";
import type { Ob11TransportSet } from "./transport.js";
import { assembleOb11Transports } from "./transport.js";

/** 毫秒 → 秒（Unix 时间戳）。 */
const MS_TO_SEC = 1000;

/** 适配器构造参数（api 相关字段继承 OneBotApiOptions，P2-16 聚合）。 */
export interface OneBot11AdapterOptions extends OneBotApiOptions {
    /** 协议配置（zod 校验 + JSON 读写）。 */
    config: ProtocolConfig<OB11Config>;
    /** network 事件广播（注册传输适配器后 emit 推给第三方）。 */
    broadcaster: EventBroadcaster;
    /** kernel 消息事件通道（消息收链路入口）。 */
    msgChannel: MsgEventChannel;
}

/** OneBot 11 协议适配器。 */
export class NapukettoOneBot11Adapter extends BaseProtocolAdapter<OB11Config> {
    readonly protocol = "onebot11";

    private readonly msgChannel: MsgEventChannel;
    private readonly selfUin: string;
    private readonly oneBotApi: OneBotApi;
    private readonly registry: ActionRegistry;
    private unsubscribe: (() => void) | null = null;
    private transports: Ob11TransportSet | null = null;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private reportSelfMessage = false;
    private messageFormat: "array" | "string" = "array";

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
        this.selfUin = opts.self.uin;
        this.oneBotApi = new OneBotApi(opts);
        this.registry = createOb11ActionRegistry({ api: this.oneBotApi });
    }

    /** 启动传输：装配（HTTP/WS）+ 打开 server/client + 广播 lifecycle enable + 起心跳。 */
    private async startTransports(config: OB11Config): Promise<void> {
        // 全局上报开关与消息格式（订阅处消费）
        this.reportSelfMessage = config.reportSelfMessage;
        this.messageFormat = config.messagePostFormat;
        const broadcaster = this.getBroadcaster();
        if (broadcaster !== undefined) {
            this.transports = assembleOb11Transports({
                config,
                broadcaster,
                selfUin: this.selfUin,
                handleRequest: (req, respond) => {
                    this.handleRequest(req, respond).catch((err: unknown) => {
                        let message = String(err);
                        if (err instanceof Error) {
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
        // onRecvMsg 回调参数为消息数组（2026-08-07 运行时实证）——遍历逐条翻译。
        this.unsubscribe = this.msgChannel.on("Msg/onRecvMsg", (msgs) => {
            forEachRawMessage(msgs, (msg) => {
                // grayTip（系统事件）→ notice；否则 → 消息事件
                if (hasGrayTip(msg)) {
                    this.broadcastNotice(msg).catch(() => {
                        // notice 翻译失败静默（grayTip 解析宽容）
                    });
                    return;
                }
                // 自身消息：默认不上报（OB11 规范行为；reportSelfMessage=true 时上报）
                if (!this.reportSelfMessage && String(msg.senderUin) === this.selfUin) {
                    return;
                }
                void this.broadcastMessageEvent(msg);
            });
        });
    }

    /**
     * 广播消息事件（P2-19：接收方向 ID 转换）。
     * 收集 at uid → 一次批量 uidToUin → 构造上下文 → 翻译广播。
     * 翻译失败退化为原样（不阻塞上报）。
     */
    private async broadcastMessageEvent(msg: RawMessage): Promise<void> {
        const elements = toCanonicalElements(msg);
        const { atUids } = collectReceiveNeeds(elements);
        let uidToUin: Map<string, string> | undefined;
        if (atUids.length > 0) {
            try {
                uidToUin = await this.oneBotApi.uidToUin(atUids);
            } catch {
                // uid 解析失败：at 原样（uid），不阻塞事件上报
            }
        }
        const ctx: ReceiveTranslateContext = {
            ...(uidToUin !== undefined ? { uidToUin } : {}),
            msgIdToOb11Id: (msgId) => this.oneBotApi.messageUnique.getMessageId(msgId),
        };
        this.broadcastEvent(
            toOb11MessageEvent(
                msg,
                this.selfUin,
                this.oneBotApi.messageUnique,
                this.messageFormat,
                ctx,
            ),
        );
    }

    /** 广播 grayTip → notice 事件（批量 uidToUin 后翻译，纯函数）。 */
    private async broadcastNotice(msg: RawMessage): Promise<void> {
        const uids = collectGrayTipUids(msg);
        let uidToUin = new Map<string, string>();
        if (uids.length > 0) {
            uidToUin = await this.oneBotApi.uidToUin(uids);
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
