/**
 * 正向 WS 客户端（主动连接 / 反向连接）
 *
 * - `open()`：建立连接，成功 resolve / 失败 reject（不自动重试，由协议层决定）
 * - `send`：连接可用时发送（序列化 JSON）
 * - 断线后按 `reconnect` 策略自动重连（attempt 计数，支持 maxAttempts）
 * - 心跳按间隔 ping
 */
import { WebSocket } from "ws";
import type { TransportAdapter, WsClientOptions } from "./types.js";

export class WsClient implements TransportAdapter {
    private readonly opts: WsClientOptions;
    private ws: WebSocket | undefined;
    private closed = false;
    private attempt = 0;
    private heartbeatTimer: NodeJS.Timeout | undefined;
    private reconnectTimer: NodeJS.Timeout | undefined;

    /** 请求分发注入点：协议层实现「请求 → 响应」。 */
    onRequest?: (req: unknown, respond: (res: unknown) => void) => void;

    constructor(opts: WsClientOptions) {
        this.opts = opts;
    }

    /** 连接可用时发送（序列化后发送）。 */
    send<T>(payload: T): void {
        const { ws } = this;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(payload));
        }
    }

    /** 建立连接：成功 resolve，失败 reject（不自动重试，由协议层决定重试策略）。
     * 2026-08-07：幂等防御——已有连接/连接中时直接返回，避免重复 open 泄漏
     * 旧连接与心跳定时器。 */
    open(): Promise<void> {
        if (this.ws !== undefined) {
            // 已连接或连接中：返回已解析 Promise（不重复建立）
            return Promise.resolve();
        }
        this.closed = false;
        this.attempt = 0;
        return new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(this.opts.url, this.buildSocketOptions());
            this.ws = ws;
            const onOpen = (): void => {
                ws.off("error", onError);
                resolve();
            };
            const onError = (err: Error): void => {
                ws.off("open", onOpen);
                // 连接失败：清掉引用（否则 open() 幂等判断误判为「已连接」）
                if (this.ws === ws) {
                    this.ws = undefined;
                }
                reject(err);
            };
            ws.on("open", onOpen);
            ws.on("error", onError);
            this.bind(ws);

            if (this.opts.heartbeat) {
                this.heartbeatTimer = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.ping();
                    }
                }, this.opts.heartbeat.intervalMs);
            }
        });
    }

    /** 关闭连接并停止重连 / 心跳。 */
    close(): void | Promise<void> {
        this.closed = true;
        if (this.reconnectTimer !== undefined) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        if (this.heartbeatTimer !== undefined) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
        const { ws } = this;
        this.ws = undefined;
        if (ws) {
            ws.close();
        }
    }
    /** 构造 WebSocket 选项（headers / 证书校验按配置透传，缺省由 ws 库决定）。 */
    private buildSocketOptions(): {
        headers?: Record<string, string>;
        rejectUnauthorized?: boolean;
    } {
        const { headers, rejectUnauthorized } = this.opts;
        const out: { headers?: Record<string, string>; rejectUnauthorized?: boolean } = {};
        if (headers !== undefined) {
            out.headers = headers;
        }
        if (rejectUnauthorized !== undefined) {
            out.rejectUnauthorized = rejectUnauthorized;
        }
        return out;
    }

    private bind(ws: WebSocket): void {
        ws.on("message", (raw) => {
            let req: unknown;
            try {
                req = JSON.parse(raw.toString()) as unknown;
            } catch {
                return;
            }
            this.onRequest?.(req, (res) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(res));
                }
            });
        });
        ws.on("error", () => {
            // ws 库要求 error 监听避免未处理异常；错误会伴随 close 触发重连逻辑
        });
        ws.on("close", () => this.onClose(ws));
    }

    private onClose(ws: WebSocket): void {
        if (this.ws !== ws) {
            return; // 旧连接残留的 close 事件，忽略
        }
        this.ws = undefined;
        if (this.closed) {
            return;
        }
        const { reconnect } = this.opts;
        if (!reconnect?.enabled) {
            return;
        }
        this.attempt += 1;
        if (reconnect.maxAttempts !== undefined && this.attempt > reconnect.maxAttempts) {
            return;
        }
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            if (this.closed) {
                return;
            }
            const next = new WebSocket(this.opts.url, this.buildSocketOptions());
            this.ws = next;
            next.on("open", () => {
                this.attempt = 0;
            });
            this.bind(next);
        }, reconnect.delayMs);
    }
}
