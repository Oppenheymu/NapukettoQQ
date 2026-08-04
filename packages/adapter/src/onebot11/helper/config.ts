/**
 * OneBot 11 协议配置（zod schema，归属本包，ADR-012）
 * 协议配置 schema 在各自协议包，kernel 只提供 ConfigBase 基类。
 */
import { z } from "zod";

/** OB11 配置 schema。 */
export const ob11ConfigSchema = z.object({
    /** HTTP 反向服务器（接收第三方调用）。 */
    http: z
        .object({
            enabled: z.boolean().default(false),
            host: z.string().default("127.0.0.1"),
            port: z.number().int().default(3000),
        })
        .default({ enabled: false, host: "127.0.0.1", port: 3000 }),
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
            port: z.number().int().default(3001),
        })
        .default({ enabled: false, host: "127.0.0.1", port: 3001 }),
    /** 正向 WS client（主动连接第三方）。 */
    wsReverse: z
        .object({
            enabled: z.boolean().default(false),
            url: z.string().optional(),
        })
        .default({ enabled: false }),
    /** 鉴权 token（HTTP/WS 校验）。 */
    token: z.string().optional(),
});

/** OB11 配置类型（由 schema 推导）。 */
export type OB11Config = z.infer<typeof ob11ConfigSchema>;
