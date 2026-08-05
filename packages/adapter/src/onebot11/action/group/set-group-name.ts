/**
 * set_group_name 动作：修改群名（P2-10 接 kernel GroupApi.modifyGroupName）
 */

import type { GroupApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const setGroupNameSchema = z.object({
    group_id: z.number(),
    group_name: z.string(),
});

type SetGroupNamePayload = z.infer<typeof setGroupNameSchema>;

/** 修改群名（P2-10 接 kernel modifyGroupName）。 */
export class SetGroupNameAction extends BaseAction<SetGroupNamePayload, null> {
    readonly name = "set_group_name";
    readonly schema = setGroupNameSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly groupApi: GroupApi;

    constructor(groupApi: GroupApi) {
        super();
        this.groupApi = groupApi;
    }

    protected async _handle(payload: SetGroupNamePayload): Promise<null> {
        await this.groupApi.modifyGroupName(String(payload.group_id), payload.group_name);
        return null;
    }
}
