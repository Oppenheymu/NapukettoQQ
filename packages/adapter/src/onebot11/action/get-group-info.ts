/**
 * get_group_info 动作：获取群信息（P2-4 接 kernel GroupApi）
 */

import type { GroupApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import type { GroupInfo } from "../types/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const getGroupInfoSchema = z.object({
    group_id: z.number(),
    /** 是否忽略缓存（go-cqhttp 扩展）。 */
    no_cache: z.boolean().optional(),
});

type GetGroupInfoPayload = z.infer<typeof getGroupInfoSchema>;

/** 获取群信息（P2-4 接 kernel apis/group）。 */
export class GetGroupInfoAction extends BaseAction<GetGroupInfoPayload, GroupInfo> {
    readonly name = "get_group_info";
    readonly schema = getGroupInfoSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly groupApi: GroupApi;

    constructor(groupApi: GroupApi) {
        super();
        this.groupApi = groupApi;
    }

    protected async _handle(payload: GetGroupInfoPayload): Promise<GroupInfo> {
        const detail = await this.groupApi.getGroupInfo(String(payload.group_id));
        return {
            group_id: Number(detail.groupCode),
            group_name: detail.groupName,
            member_count: detail.memberNum,
            max_member_count: detail.maxMemberNum,
        };
    }
}
