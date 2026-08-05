/**
 * set_diy_online_status 动作：设置自定义在线状态（P2-12 接 kernel setOnlineStatus）
 *
 * customStatus（faceId/wording/faceType）随 setStatus 一并提交；
 * status 缺省 10（在线）。
 */

import type { MsgApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const setDiyOnlineStatusSchema = z.object({
    status: z.number().optional(),
    /** 自定义状态文案。 */
    wording: z.string(),
    /** 表情 ID。 */
    face_id: z.string().optional(),
    /** 表情类型。 */
    face_type: z.string().optional(),
});

type SetDiyOnlineStatusPayload = z.infer<typeof setDiyOnlineStatusSchema>;

/** 默认在线状态值。 */
const STATUS_ONLINE = 10;

/** 设置自定义在线状态（P2-12 接 kernel setOnlineStatus customStatus）。 */
export class SetDiyOnlineStatusAction extends BaseAction<SetDiyOnlineStatusPayload, null> {
    readonly name = "set_diy_online_status";
    readonly schema = setDiyOnlineStatusSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly msgApi: MsgApi;

    constructor(msgApi: MsgApi) {
        super();
        this.msgApi = msgApi;
    }

    protected async _handle(payload: SetDiyOnlineStatusPayload): Promise<null> {
        const customStatus = {
            faceId: payload.face_id ?? "",
            wording: payload.wording,
            faceType: payload.face_type ?? "1",
        };
        await this.msgApi.setOnlineStatus({
            status: payload.status ?? STATUS_ONLINE,
            extStatus: 0,
            batteryStatus: 0,
            customStatus,
        });
        return null;
    }
}
