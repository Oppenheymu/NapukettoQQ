/**
 * 反向 HTTP server（hono + @hono/node-server）
 *
 * 接收第三方调用：POST JSON → `onRequest` 注入点（协议层分发）→ 响应回发。
 * 鉴权（token）通过 `authorize` 钩子，规则由协议层决定。
 */

import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";
import type { Context } from "hono";
import { Hono } from "hono";
import type {
    HttpRouteContext,
    HttpServerOptions,
    RequestContext,
    Respond,
    TransportAdapter,
} from "./types.js";

const HTTP_STATUS = {
    badRequest: 400,
    unauthorized: 401,
} as const;

function toRequestContext(c: Context): RequestContext {
    const raw = c.req.header();
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(raw)) {
        headers[key] = value;
    }
    return { url: c.req.url, headers };
}

export class HttpServer implements TransportAdapter {
    private readonly app: Hono;
    private readonly opts: HttpServerOptions;
    private server: ServerType | undefined;

    /** 请求分发注入点：协议层实现「请求 → 响应」（整机入口，OB11 用）。 */
    onRequest?: (req: unknown, respond: Respond) => void;
    /**
     * 路径路由注入点（协议无关扩展，Satori RPC 用）：
     * 按 path/method 分发。设置了 onPathRequest 时优先于 onRequest。
     */
    onPathRequest?: (ctx: HttpRouteContext, req: unknown, respond: Respond) => void;

    constructor(opts: HttpServerOptions) {
        this.opts = opts;
        this.app = new Hono();
        this.app.all("*", (c) => this.handle(c));
    }

    /**
     * 处理所有 HTTP 请求：
     * 鉴权 → 解析 JSON body → 交 onPathRequest / onRequest → 响应。
     * respond 可选 status（Satori 404/501 等）；缺省 200。
     */
    private async handle(c: Context): Promise<Response> {
        const { authorize } = this.opts;
        if (authorize) {
            const ctx = toRequestContext(c);
            if (!authorize(ctx)) {
                return c.json({ error: "unauthorized" }, HTTP_STATUS.unauthorized);
            }
        }

        let req: unknown;
        try {
            req = (await c.req.json()) as unknown;
        } catch {
            return c.json({ error: "invalid json body" }, HTTP_STATUS.badRequest);
        }

        return new Promise<Response>((resolve) => {
            const respond: Respond = (res, status) => {
                const statusCode = status ?? 200;
                resolve(
                    new Response(JSON.stringify(res), {
                        status: statusCode,
                        headers: { "Content-Type": "application/json" },
                    }),
                );
            };
            if (this.onPathRequest !== undefined) {
                this.onPathRequest({ path: c.req.path, method: c.req.method }, req, respond);
            } else {
                this.onRequest?.(req, respond);
            }
        });
    }

    /** HTTP 反向为被动接收，无主动推送。 */
    send<T>(_payload: T): void {
        // no-op
    }

    async open(): Promise<void> {
        if (this.server) {
            return;
        }
        await new Promise<void>((resolve, _reject) => {
            const srv = serve(
                {
                    fetch: this.app.fetch,
                    hostname: this.opts.host,
                    port: this.opts.port,
                },
                () => {
                    this.server = srv;
                    resolve();
                },
            );
        });
    }

    async close(): Promise<void> {
        const { server } = this;
        if (!server) {
            return;
        }
        await new Promise<void>((resolve) => {
            server.close(() => {
                this.server = undefined;
                resolve();
            });
        });
    }
}
