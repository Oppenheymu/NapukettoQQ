/**
 * @napuketto/network 入口（协议无关传输层）
 *
 * 传输原语：HTTP server/client、WS server/client、泛型广播总线。
 * 不 import 任何协议包，事件类型泛型化（ADR-002）。
 */
export { EventBroadcaster } from "./broadcaster.js";
export { HttpClient } from "./http-client.js";
export { HttpServer } from "./http-server.js";
export type {
    AuthorizeHook,
    HttpClientOptions,
    HttpRouteContext,
    HttpServerOptions,
    RequestContext,
    Respond,
    ServerOptions,
    TransportAdapter,
    WsClientOptions,
    WsServerOptions,
} from "./types.js";
export { WsClient } from "./ws-client.js";
export { WsServer } from "./ws-server.js";
