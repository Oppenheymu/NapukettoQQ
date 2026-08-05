/**
 * get_group_member_list 动作：获取群成员列表（P2-4 接 kernel GroupApi）
 */

import type { GroupApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import { toOb11GroupMemberInfo } from "../helper/translate.js";
import type { GroupMemberInfo } from "../types/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const getGroupMemberListSchema = z.object({
    group_id: z.number(),
    /** 是否忽略缓存（go-cqhttp 扩展）。 */
    no_cache: z.boolean().optional(),
});

type GetGroupMemberListPayload = z.infer<typeof getGroupMemberListSchema>;

/** 获取群成员列表（P2-4 接 kernel apis/group）。 */
export class GetGroupMemberListAction extends BaseAction<
    GetGroupMemberListPayload,
    GroupMemberInfo[]
> {
    readonly name = "get_group_member_list";
    readonly schema = getGroupMemberListSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly groupApi: GroupApi;

    constructor(groupApi: GroupApi) {
        super();
        this.groupApi = groupApi;
    }

    protected async _handle(payload: GetGroupMemberListPayload): Promise<GroupMemberInfo[]> {
        const groupCode = String(payload.group_id);
        const members = await this.groupApi.getGroupMemberList(
            groupCode,
            payload.no_cache === true,
        );
        const uinMap = await this.groupApi.uidToUin(members.map((m) => m.uid));
        return members.map((m) => toOb11GroupMemberInfo(groupCode, m, uinMap));
    }
}
