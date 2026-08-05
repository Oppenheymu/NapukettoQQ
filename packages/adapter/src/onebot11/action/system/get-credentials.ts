/**
 * get_csrf_token / get_credentials 动作（P2-15 接 kernel TicketApi）
 *
 * - get_csrf_token：qun.qq.com cookies 的 skey → bkn（csrf 等价物）
 * - get_credentials：指定域名 cookies + bkn → { cookies, csrf_token }
 */
import { TicketApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getCsrfTokenSchema = z.object({});

type GetCsrfTokenPayload = z.infer<typeof getCsrfTokenSchema>;

/** 默认域名（bkn 计算用）。 */
const DEFAULT_DOMAIN = "qun.qq.com";

/** 获取 csrf_token（bkn，P2-15）。 */
export class GetCsrfTokenAction extends BaseAction<GetCsrfTokenPayload, { token: number }> {
    readonly name = "get_csrf_token";
    readonly schema = getCsrfTokenSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: { ticketApi: TicketApi; selfUin: string };

    constructor(deps: { ticketApi: TicketApi; selfUin: string }) {
        super();
        this.deps = deps;
    }

    protected async _handle(_payload: GetCsrfTokenPayload): Promise<{ token: number }> {
        const cookies = await this.deps.ticketApi.getCookies(DEFAULT_DOMAIN, this.deps.selfUin);
        const skey = cookies["skey"] ?? "";
        return { token: Number(TicketApi.getBkn(skey)) };
    }
}

const getCredentialsSchema = z.object({
    domain: z.string().optional(),
});

type GetCredentialsPayload = z.infer<typeof getCredentialsSchema>;

/** 获取凭据（cookies + csrf_token，P2-15）。 */
export class GetCredentialsAction extends BaseAction<
    GetCredentialsPayload,
    { cookies: Record<string, string>; csrf_token: number }
> {
    readonly name = "get_credentials";
    readonly schema = getCredentialsSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: { ticketApi: TicketApi; selfUin: string };

    constructor(deps: { ticketApi: TicketApi; selfUin: string }) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: GetCredentialsPayload): Promise<{
        cookies: Record<string, string>;
        csrf_token: number;
    }> {
        const domain = payload.domain ?? DEFAULT_DOMAIN;
        const cookies = await this.deps.ticketApi.getCookies(domain, this.deps.selfUin);
        return {
            cookies,
            csrf_token: Number(TicketApi.getBkn(cookies["skey"] ?? "")),
        };
    }
}
