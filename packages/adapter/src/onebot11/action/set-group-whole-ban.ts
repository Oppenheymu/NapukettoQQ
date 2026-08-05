/**
 * set_group_whole_ban 动作：群组全员禁言（P2-10 接 kernel GroupApi.setGroupShutUp）
 */

import type { GroupApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const setGroupWholeBanSchema = z.object({
    group_id: z.number(),
    /** 是否开启全员禁言。 */
    enable: z.boolean().default(true),
});

type SetGroupWholeBanPayload = z.infer<typeof setGroupWholeBanSchema>;

/** 群组全员禁言（P2-10 接 kernel setGroupShutUp）。 */
export class SetGroupWholeBanAction extends BaseAction<SetGroupWholeBanPayload, null> {
    readonly name = "set_group_whole_ban";
    readonly schema = setGroupWholeBanSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly groupApi: GroupApi;

    constructor(groupApi: GroupApi) {
        super();
        this.groupApi = groupApi;
    }

    protected async _handle(payload: SetGroupWholeBanPayload): Promise<null> {
        await this.groupApi.setGroupShutUp(String(payload.group_id), payload.enable);
        return null;
    }
}
