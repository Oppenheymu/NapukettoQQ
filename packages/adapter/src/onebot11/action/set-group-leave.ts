/**
 * set_group_leave 动作：退出群聊（P2-10 接 kernel GroupApi.quitGroup）
 *
 * is_dismiss=true 解散群（仅群主）。
 */

import type { GroupApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const setGroupLeaveSchema = z.object({
    group_id: z.number(),
    /** 是否解散群（仅群主可用）。 */
    is_dismiss: z.boolean().optional().default(false),
});

type SetGroupLeavePayload = z.infer<typeof setGroupLeaveSchema>;

/** 退出群聊（P2-10 接 kernel quitGroup）。 */
export class SetGroupLeaveAction extends BaseAction<SetGroupLeavePayload, null> {
    readonly name = "set_group_leave";
    readonly schema = setGroupLeaveSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly groupApi: GroupApi;

    constructor(groupApi: GroupApi) {
        super();
        this.groupApi = groupApi;
    }

    protected async _handle(payload: SetGroupLeavePayload): Promise<null> {
        await this.groupApi.quitGroup(String(payload.group_id), payload.is_dismiss);
        return null;
    }
}
