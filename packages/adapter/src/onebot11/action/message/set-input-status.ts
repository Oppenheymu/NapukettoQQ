/**
 * set_input_status 动作：发送输入状态（NapCat 扩展，P2-11）
 *
 * user_id → uinToUid → MsgApi.setInputStatus(peer, eventType)。
 * eventType：1=输入中，0=停止输入。
 */

import { ChatType } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import { ob11ErrorCodeMap } from "../error-map.js";
import { resolveUid } from "../resolve-uid.js";

const setInputStatusSchema = z.object({
    user_id: z.number(),
    /** 输入事件类型：1=输入中，0=停止。 */
    event_type: z.number().optional(),
});

type SetInputStatusPayload = z.infer<typeof setInputStatusSchema>;

/** 输入中事件类型。 */
const EVENT_TYPE_TYPING = 1;

/** set_input_status 依赖（OneBotApi 视图）。 */
export type SetInputStatusDeps = Pick<OneBotApi, "msgApi" | "uinToUid">;

/** 发送输入状态（P2-11 接 kernel setInputStatus）。 */
export class SetInputStatusAction extends BaseAction<SetInputStatusPayload, null> {
    readonly name = "set_input_status";
    readonly schema = setInputStatusSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: SetInputStatusDeps;

    constructor(deps: SetInputStatusDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: SetInputStatusPayload): Promise<null> {
        const uid = await resolveUid(String(payload.user_id), this.deps.uinToUid);
        await this.deps.msgApi.setInputStatus(
            { chatType: ChatType.C2C, peerUid: uid },
            payload.event_type ?? EVENT_TYPE_TYPING,
        );
        return null;
    }
}
