/**
 * OneBot 11 协议配置（zod schema，归属本包，ADR-012）
 * 协议配置 schema 在各自协议包，kernel 只提供 ConfigBase 基类。
 */
import { z } from "zod";

/** HTTP 反向服务器默认端口。 */
const DEFAULT_HTTP_PORT = 3000;
/** 反向 WS server 默认端口。 */
const DEFAULT_WS_PORT = 3001;
/** 心跳 meta 事件默认间隔（毫秒）。 */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 3000;

/** OB11 配置 schema。 */
export const ob11ConfigSchema = z.object({
    /** HTTP 反向服务器（接收第三方调用）。 */
    http: z
        .object({
            enabled: z.boolean().default(false),
            host: z.string().default("127.0.0.1"),
            port: z.number().int().default(DEFAULT_HTTP_PORT),
        })
        .default({ enabled: false, host: "127.0.0.1", port: DEFAULT_HTTP_PORT }),
    /** HTTP 正向上报（事件上报到第三方）。 */
    httpPost: z
        .object({
            enabled: z.boolean().default(false),
            url: z.string().optional(),
        })
        .default({ enabled: false }),
    /** 反向 WS server（第三方主动连入）。 */
    ws: z
        .object({
            enabled: z.boolean().default(false),
            host: z.string().default("127.0.0.1"),
            port: z.number().int().default(DEFAULT_WS_PORT),
        })
        .default({ enabled: false, host: "127.0.0.1", port: DEFAULT_WS_PORT }),
    /** 正向 WS client（主动连接第三方）。 */
    wsReverse: z
        .object({
            enabled: z.boolean().default(false),
            url: z.string().optional(),
        })
        .default({ enabled: false }),
    /** 鉴权 token（HTTP/WS 校验）。 */
    token: z.string().optional(),
    /** 心跳 meta 事件间隔（毫秒），0 关闭心跳。 */
    heartbeatInterval: z.number().int().default(DEFAULT_HEARTBEAT_INTERVAL_MS),
});

/** OB11 配置类型（由 schema 推导）。 */
export type OB11Config = z.infer<typeof ob11ConfigSchema>;
