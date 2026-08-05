/**
 * OB11 传输装配（P2-5，2026-08-05）
 *
 * 按 OB11Config 创建/装配 network 传输适配器：
 *  - HTTP 反向（http.enabled）：HttpServer 接收第三方调用 → handleRequest → 响应
 *  - WS 反向（ws.enabled）：WsServer 第三方连入 → handleRequest（echo 透传）+ 事件广播
 *  - HTTP 正向（httpPost.enabled）：HttpClient 事件上报（fire-and-forget）
 *  - WS 正向（wsReverse.enabled）：WsClient 主动连第三方（双向）
 *
 * 鉴权：token 存在时校验 Authorization: Bearer <token> / access_token 查询参数。
 * 返回 transports（事件上报用，注册到 broadcaster）与 close（停止时关闭全部）。
 */
import {
    type AuthorizeHook,
    type EventBroadcaster,
    HttpClient,
    HttpServer,
    type RequestContext,
    type TransportAdapter,
    WsClient,
    WsServer,
} from "@napuketto/network";
import type { OB11Config } from "./helper/config.js";

/** Authorization 头前缀。 */
const BEARER_PREFIX = "Bearer ";

/** 校验 URL 查询参数里的 access_token（WS client 连接 URL 可能带）。 */
function hasAccessTokenQuery(url: string, token: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.searchParams.get("access_token") === token;
    } catch {
        return false;
    }
}

/** 校验 Authorization: Bearer <token> 头。 */
function checkBearer(auth: string | undefined, token: string): boolean {
    if (auth === undefined || !auth.startsWith(BEARER_PREFIX)) {
        return false;
    }
    return auth.slice(BEARER_PREFIX.length) === token;
}

/** 构造鉴权钩子（token 未配置则不鉴权）。 */
function makeAuthorize(token: string | undefined): AuthorizeHook | undefined {
    if (token === undefined || token === "") {
        return;
    }
    return (ctx: RequestContext): boolean => {
        const auth = ctx.headers["authorization"] ?? ctx.headers["Authorization"];
        if (checkBearer(auth, token) || ctx.headers["authorization"] === token) {
            return true;
        }
        return hasAccessTokenQuery(ctx.url, token);
    };
}

/** 传输装配结果。 */
export interface Ob11TransportSet {
    /** 反向 server（HTTP/WS，第三方调用入口）。 */
    servers: TransportAdapter[];
    /** 事件上报传输（正向 client，已注册到 broadcaster）。 */
    transports: TransportAdapter[];
    /** 停止：关闭全部传输（幂等）。 */
    close: () => Promise<void>;
}

/** 传输装配选项。 */
export interface AssembleOb11TransportsOptions {
    /** OB11 配置。 */
    config: OB11Config;
    /** 事件广播（正向上报传输注册到它）。 */
    broadcaster: EventBroadcaster;
    /** 请求分发（adapter.handleRequest，HTTP/WS 共用）。 */
    handleRequest: (req: unknown, respond: (res: unknown) => void) => void;
}

/** 按配置装配 OB11 传输。 */
export function assembleOb11Transports(opts: AssembleOb11TransportsOptions): Ob11TransportSet {
    const { config, broadcaster, handleRequest } = opts;
    const authorize = makeAuthorize(config.token);
    const servers: TransportAdapter[] = [];
    const transports: TransportAdapter[] = [];

    assembleHttpServer(config, authorize, handleRequest, servers);
    assembleWsServer(config, authorize, handleRequest, servers);
    assembleHttpPost(config, transports);
    assembleWsReverse(config, handleRequest, transports);

    // 注册事件上报传输
    for (const t of transports) {
        broadcaster.register(t);
    }

    return {
        servers,
        transports,
        close: async () => {
            await Promise.all([...servers, ...transports].map((t) => t.close()));
            for (const t of transports) {
                broadcaster.unregister(t);
            }
        },
    };
}

/** 装配 HTTP 反向 server。 */
function assembleHttpServer(
    config: OB11Config,
    authorize: AuthorizeHook | undefined,
    handleRequest: (req: unknown, respond: (res: unknown) => void) => void,
    servers: TransportAdapter[],
): void {
    if (!config.http.enabled) {
        return;
    }
    const options: ConstructorParameters<typeof HttpServer>[0] = {
        host: config.http.host,
        port: config.http.port,
    };
    if (authorize !== undefined) {
        options.authorize = authorize;
    }
    const server = new HttpServer(options);
    server.onRequest = handleRequest;
    servers.push(server);
}

/** 装配 WS 反向 server。 */
function assembleWsServer(
    config: OB11Config,
    authorize: AuthorizeHook | undefined,
    handleRequest: (req: unknown, respond: (res: unknown) => void) => void,
    servers: TransportAdapter[],
): void {
    if (!config.ws.enabled) {
        return;
    }
    const options: ConstructorParameters<typeof WsServer>[0] = {
        host: config.ws.host,
        port: config.ws.port,
        heartbeat: { intervalMs: 30_000 },
    };
    if (authorize !== undefined) {
        options.authorize = authorize;
    }
    const server = new WsServer(options);
    server.onRequest = handleRequest;
    servers.push(server);
}

/** 装配 HTTP 正向上报 client。 */
function assembleHttpPost(config: OB11Config, transports: TransportAdapter[]): void {
    if (!config.httpPost.enabled || config.httpPost.url === undefined) {
        return;
    }
    const headers = authorizeHeader(config.token);
    const options: ConstructorParameters<typeof HttpClient>[0] = {
        url: config.httpPost.url,
    };
    if (headers !== undefined) {
        options.headers = headers;
    }
    transports.push(new HttpClient(options));
}

/** 装配 WS 正向 client（双向）。 */
function assembleWsReverse(
    config: OB11Config,
    handleRequest: (req: unknown, respond: (res: unknown) => void) => void,
    transports: TransportAdapter[],
): void {
    if (!config.wsReverse.enabled || config.wsReverse.url === undefined) {
        return;
    }
    const headers = authorizeHeader(config.token);
    const options: ConstructorParameters<typeof WsClient>[0] = {
        url: config.wsReverse.url,
        heartbeat: { intervalMs: 30_000 },
    };
    if (headers !== undefined) {
        options.headers = headers;
    }
    const client = new WsClient(options);
    client.onRequest = handleRequest;
    transports.push(client);
}

/** token → Authorization 头（client 上报/连接用）。 */
function authorizeHeader(token: string | undefined): Record<string, string> | undefined {
    if (token === undefined || token === "") {
        return;
    }
    return { authorization: `${BEARER_PREFIX}${token}` };
}
