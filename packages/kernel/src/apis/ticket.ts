/**
 * TicketApi：票据语义化 API（ADR-009 统一错误语义，P2-13）
 *
 * - getClientKey：TicketService.forceFetchClientKey 解包（get_clientkey）
 * - getCookies：clientKey → ssl.ptlogin2.qq.com/jump 跳转 → 解析 set-cookie 头
 *   （fetch 会吞掉 Set-Cookie 头，故用 node:https 手动请求）
 */
import { get as httpsGet } from "node:https";
import { kernelError } from "../errors.js";
import type {
    ForceFetchClientKeyRetType,
    NodeIKernelTicketService,
} from "../types/services/ticket-service.js";
import type { NodeIQQNTWrapperSession } from "../types/wrapper.js";

/** 跳转请求超时（毫秒）。 */
const JUMP_TIMEOUT_MS = 10_000;

/** 票据 API：从 session 拿 ticket service，包装成语义化方法。 */
export class TicketApi {
    private readonly service: NodeIKernelTicketService;

    constructor(session: NodeIQQNTWrapperSession) {
        const service = session.getTicketService() as unknown as NodeIKernelTicketService | null;
        if (service === null || service === undefined) {
            throw kernelError("getTicketService() 返回空（session 未 init）", "INVALID_STATE");
        }
        this.service = service;
    }

    /** 获取 clientKey（get_clientkey）。 */
    async getClientKey(): Promise<ForceFetchClientKeyRetType> {
        const raw = await this.service.forceFetchClientKey("");
        if (raw.result !== 0 || raw.clientKey === "") {
            throw kernelError(`forceFetchClientKey 失败: ${raw.errMsg}`, "UNKNOWN");
        }
        return raw;
    }

    /** 获取指定域名的 cookies（get_cookies；uin 为机器人 QQ 号）。 */
    async getCookies(domain: string, uin: string): Promise<Record<string, string>> {
        const { clientKey } = await this.getClientKey();
        const u1 = `https://${domain}/${uin}/infocenter`;
        const jumpUrl =
            "https://ssl.ptlogin2.qq.com/jump?ptlang=1033" +
            `&clientuin=${encodeURIComponent(uin)}` +
            `&clientkey=${encodeURIComponent(clientKey)}` +
            `&u1=${encodeURIComponent(u1)}` +
            "&keyindex=19";
        return fetchJumpCookies(jumpUrl);
    }

    /** 计算 bkn（get_csrf_token 与 web 接口共用；skey → bkn 哈希）。 */
    static getBkn(skey: string): string {
        let hash = 5381;
        for (let i = 0; i < skey.length; i += 1) {
            const code = skey.charCodeAt(i);
            hash = hash + (hash << 5) + code;
        }
        return (hash & 0x7f_ff_ff_ff).toString();
    }
}

/** 请求 jump 地址并解析 set-cookie → dict（fetch 吞 Set-Cookie，故用 node:https）。 */
function fetchJumpCookies(url: string): Promise<Record<string, string>> {
    return new Promise((resolve, reject) => {
        const req = httpsGet(
            url,
            {
                headers: {
                    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                },
            },
            (res) => {
                const cookies = parseSetCookieHeaders(res.headers["set-cookie"]);
                res.resume();
                res.on("end", () => resolve(cookies));
            },
        );
        req.setTimeout(JUMP_TIMEOUT_MS, () => {
            req.destroy();
            reject(new Error("获取 cookies 超时"));
        });
        req.on("error", (err) => reject(err));
    });
}

/** 解析 set-cookie 头数组 → { name: value } dict。 */
function parseSetCookieHeaders(raw: string[] | undefined): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (raw === undefined) {
        return cookies;
    }
    for (const line of raw) {
        const [pair] = line.split(";");
        if (pair !== undefined) {
            const eq = pair.indexOf("=");
            if (eq > 0) {
                const name = pair.slice(0, eq).trim();
                const value = pair.slice(eq + 1);
                if (name !== "") {
                    cookies[name] = value;
                }
            }
        }
    }
    return cookies;
}
