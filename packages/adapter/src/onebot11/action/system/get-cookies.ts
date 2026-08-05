/**
 * get_cookies 动作：获取 cookies（P2-13 接 kernel TicketApi.getCookies）
 *
 * domain 缺省 v2.qq.com（NapCat 行为）；user_id 缺省用机器人自身 uin。
 */

import type { TicketApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getCookiesSchema = z.object({
    domain: z.string().optional(),
    user_id: z.number().optional(),
});

type GetCookiesPayload = z.infer<typeof getCookiesSchema>;

/** 默认域名。 */
const DEFAULT_DOMAIN = "v2.qq.com";

/** 获取 cookies（P2-13 接 kernel TicketApi.getCookies）。 */
export class GetCookiesAction extends BaseAction<GetCookiesPayload, Record<string, string>> {
    readonly name = "get_cookies";
    readonly schema = getCookiesSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: { ticketApi: TicketApi; selfUin: string };

    constructor(deps: { ticketApi: TicketApi; selfUin: string }) {
        super();
        this.deps = deps;
    }

    protected _handle(payload: GetCookiesPayload): Promise<Record<string, string>> {
        const domain = payload.domain ?? DEFAULT_DOMAIN;
        let uin = this.deps.selfUin;
        if (payload.user_id !== undefined) {
            uin = String(payload.user_id);
        }
        return this.deps.ticketApi.getCookies(domain, uin);
    }
}
