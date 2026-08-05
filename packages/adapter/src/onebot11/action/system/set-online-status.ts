/**
 * set_online_status 动作：设置在线状态（P2-12 接 kernel MsgApi.setOnlineStatus）
 *
 * status/ext_status/battery_status 见 NapCat 状态表（在线 10 / 离开 30 / 隐身 40
 * / 忙碌 50 / Q我吧 60 / 请勿打扰 70 等）。
 */

import type { MsgApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const setOnlineStatusSchema = z.object({
    status: z.number().optional(),
    ext_status: z.number().optional(),
    battery_status: z.number().optional(),
});

type SetOnlineStatusPayload = z.infer<typeof setOnlineStatusSchema>;

/** 默认在线状态值。 */
const STATUS_ONLINE = 10;

/** 设置在线状态（P2-12 接 kernel setOnlineStatus）。 */
export class SetOnlineStatusAction extends BaseAction<SetOnlineStatusPayload, null> {
    readonly name = "set_online_status";
    readonly schema = setOnlineStatusSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly msgApi: MsgApi;

    constructor(msgApi: MsgApi) {
        super();
        this.msgApi = msgApi;
    }

    protected async _handle(payload: SetOnlineStatusPayload): Promise<null> {
        await this.msgApi.setOnlineStatus({
            status: payload.status ?? STATUS_ONLINE,
            extStatus: payload.ext_status ?? 0,
            batteryStatus: payload.battery_status ?? 0,
        });
        return null;
    }
}
