/**
 * get_group_at_all_remain 动作：获取群 @全体成员 剩余次数（NapCat 扩展，P2-10）
 */

import type { GroupApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const getGroupAtAllRemainSchema = z.object({
    group_id: z.number(),
});

type GetGroupAtAllRemainPayload = z.infer<typeof getGroupAtAllRemainSchema>;

/** @全体剩余次数返回结构。 */
export interface AtAllRemainInfo {
    can_at_all: boolean;
    remain_at_all_count_for_uin: number;
    remain_at_all_count_for_group: number;
}

/** 获取群 @全体成员 剩余次数（P2-10 接 kernel getGroupRemainAtTimes）。 */
export class GetGroupAtAllRemainAction extends BaseAction<
    GetGroupAtAllRemainPayload,
    AtAllRemainInfo
> {
    readonly name = "get_group_at_all_remain";
    readonly schema = getGroupAtAllRemainSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly groupApi: GroupApi;

    constructor(groupApi: GroupApi) {
        super();
        this.groupApi = groupApi;
    }

    protected async _handle(payload: GetGroupAtAllRemainPayload): Promise<AtAllRemainInfo> {
        const remain = await this.groupApi.getGroupRemainAtTimes(String(payload.group_id));
        return {
            can_at_all: remain.canAtAll,
            remain_at_all_count_for_uin: remain.remainAtAllCountForUin,
            remain_at_all_count_for_group: remain.remainAtAllCountForGroup,
        };
    }
}
