/**
 * Satori 协议配置（zod schema，归属本包，ADR-012）
 * 协议配置 schema 在各自协议包，kernel 只提供 ConfigBase 基类。
 */
import { z } from "zod";

/** HTTP RPC 服务器默认端口（satori.chat 惯例 5500 区间，取 5500）。 */
const DEFAULT_HTTP_PORT = 5500;
/** WS 事件服务默认端口（satori.chat 惯例 5500 区间，取 5501）。 */
const DEFAULT_WS_PORT = 5501;

/** HTTP RPC 服务器实例（POST /v1/{resource}.{method}）。 */
const httpServerSchema = z.object({
    enabled: z.boolean().default(false),
    host: z.string().default("127.0.0.1"),
    port: z.number().int().default(DEFAULT_HTTP_PORT),
    /** 实例级 token，覆盖全局 token（缺省继承全局）。 */
    token: z.string().optional(),
});

/** WS 事件服务实例（/v1/events 信令，第三方 SDK 连入）。 */
const wsServerSchema = z.object({
    enabled: z.boolean().default(false),
    host: z.string().default("127.0.0.1"),
    port: z.number().int().default(DEFAULT_WS_PORT),
    /** 实例级 token，覆盖全局 token（缺省继承全局）。 */
    token: z.string().optional(),
});

/** Satori 配置 schema。 */
export const satoriConfigSchema = z.object({
    /** 鉴权 token（全局默认，实例未指定时继承）。 */
    token: z.string().optional(),
    /** 媒体资源（img/audio/video/file）下载缓存目录。 */
    cacheDir: z.string().optional(),
    /** HTTP RPC 服务器列表。 */
    httpServers: z.array(httpServerSchema).default([]),
    /** WS 事件服务列表。 */
    wsServers: z.array(wsServerSchema).default([]),
});

/** Satori 配置类型（由 schema 推导）。 */
export type SatoriConfig = z.infer<typeof satoriConfigSchema>;
