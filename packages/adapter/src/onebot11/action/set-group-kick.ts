/**
 * set_group_kick 动作：群组踢人（P2-10 接 kernel GroupApi.kickMember）
 *
 * user_id（uin）→ uinToUid → kickMember（kickMemberV2）。
 */

import type { GroupApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const setGroupKickSchema = z.object({
    group_id: z.number(),
    user_id: z.number(),
    /** 是否拒绝加群请求（拉黑）。 */
    reject_add_request: z.boolean().optional(),
    /** 踢人理由。 */
    kick_reason: z.string().optional(),
});

type SetGroupKickPayload = z.infer<typeof setGroupKickSchema>;

/** 群组踢人（P2-10 接 kernel kickMember）。 */
export class SetGroupKickAction extends BaseAction<SetGroupKickPayload, null> {
    readonly name = "set_group_kick";
    readonly schema = setGroupKickSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly groupApi: GroupApi;

    constructor(groupApi: GroupApi) {
        super();
        this.groupApi = groupApi;
    }

    protected async _handle(payload: SetGroupKickPayload): Promise<null> {
        const uid = await this.resolveUid(payload.user_id);
        await this.groupApi.kickMember(
            String(payload.group_id),
            [uid],
            payload.reject_add_request === true,
            payload.kick_reason ?? "",
        );
        return null;
    }

    /** user_id（uin）→ uid。 */
    private async resolveUid(userId: number): Promise<string> {
        const uidMap = await this.groupApi.uinToUid([String(userId)]);
        const uid = uidMap.get(String(userId));
        if (uid === undefined) {
            throw new Error(`用户 ${userId} 的 uid 解析失败`);
        }
        return uid;
    }
}
