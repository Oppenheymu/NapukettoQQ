/**
 * get_clientkey 动作：获取 clientKey（P2-13 接 kernel TicketApi.getClientKey）
 */

import type { TicketApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getClientkeySchema = z.object({});

type GetClientkeyPayload = z.infer<typeof getClientkeySchema>;

/** 获取 clientKey（P2-13 接 kernel TicketApi）。 */
export class GetClientkeyAction extends BaseAction<
    GetClientkeyPayload,
    { clientKey: string; keyIndex: string; expireTime: string; url: string }
> {
    readonly name = "get_clientkey";
    readonly schema = getClientkeySchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly ticketApi: TicketApi;

    constructor(ticketApi: TicketApi) {
        super();
        this.ticketApi = ticketApi;
    }

    protected async _handle(_payload: GetClientkeyPayload): Promise<{
        clientKey: string;
        keyIndex: string;
        expireTime: string;
        url: string;
    }> {
        const raw = await this.ticketApi.getClientKey();
        return {
            clientKey: raw.clientKey,
            keyIndex: raw.keyIndex,
            expireTime: raw.expireTime,
            url: raw.url,
        };
    }
}
