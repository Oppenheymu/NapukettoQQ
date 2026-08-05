/**
 * get_group_list 动作：获取群列表（P2-4 接 kernel GroupApi）
 */

import type { GroupApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import { toOb11GroupInfo } from "../../helper/translate.js";
import type { GroupInfo } from "../../types/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getGroupListSchema = z.object({
    /** 是否忽略缓存（go-cqhttp 扩展）。 */
    no_cache: z.boolean().optional(),
});

type GetGroupListPayload = z.infer<typeof getGroupListSchema>;

/** 获取群列表（P2-4 接 kernel apis/group）。 */
export class GetGroupListAction extends BaseAction<GetGroupListPayload, GroupInfo[]> {
    readonly name = "get_group_list";
    readonly schema = getGroupListSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly groupApi: GroupApi;

    constructor(groupApi: GroupApi) {
        super();
        this.groupApi = groupApi;
    }

    protected async _handle(payload: GetGroupListPayload): Promise<GroupInfo[]> {
        const groups = await this.groupApi.getGroupList(payload.no_cache === true);
        return groups.map(toOb11GroupInfo);
    }
}
