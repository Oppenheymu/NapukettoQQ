/**
 * set_group_ban 动作：群组单人禁言（P2-10 接 kernel GroupApi.setMemberShutUp）
 *
 * duration 秒（0 解除禁言）；user_id → uinToUid。
 */

import type { GroupApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

/** 默认禁言时长（秒）。 */
const DEFAULT_BAN_DURATION = 30;

const setGroupBanSchema = z.object({
    group_id: z.number(),
    user_id: z.number(),
    /** 禁言时长（秒），0 解除。 */
    duration: z.number().default(DEFAULT_BAN_DURATION),
});

type SetGroupBanPayload = z.infer<typeof setGroupBanSchema>;

/** 群组单人禁言（P2-10 接 kernel setMemberShutUp）。 */
export class SetGroupBanAction extends BaseAction<SetGroupBanPayload, null> {
    readonly name = "set_group_ban";
    readonly schema = setGroupBanSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly groupApi: GroupApi;

    constructor(groupApi: GroupApi) {
        super();
        this.groupApi = groupApi;
    }

    protected async _handle(payload: SetGroupBanPayload): Promise<null> {
        const uidMap = await this.groupApi.uinToUid([String(payload.user_id)]);
        const uid = uidMap.get(String(payload.user_id));
        if (uid === undefined) {
            throw new Error(`用户 ${payload.user_id} 的 uid 解析失败`);
        }
        await this.groupApi.setMemberShutUp(String(payload.group_id), [
            { uid, duration: payload.duration },
        ]);
        return null;
    }
}
