/**
 * get_group_member_info 动作：获取群成员信息（P2-4 接 kernel GroupApi）
 */

import type { GroupApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import { toOb11GroupMemberInfo } from "../helper/translate.js";
import type { GroupMemberInfo } from "../types/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const getGroupMemberInfoSchema = z.object({
    group_id: z.number(),
    user_id: z.number(),
    /** 是否忽略缓存（go-cqhttp 扩展）。 */
    no_cache: z.boolean().optional(),
});

type GetGroupMemberInfoPayload = z.infer<typeof getGroupMemberInfoSchema>;

/** 获取群成员信息（P2-4 接 kernel apis/group）。 */
export class GetGroupMemberInfoAction extends BaseAction<
    GetGroupMemberInfoPayload,
    GroupMemberInfo
> {
    readonly name = "get_group_member_info";
    readonly schema = getGroupMemberInfoSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly groupApi: GroupApi;

    constructor(groupApi: GroupApi) {
        super();
        this.groupApi = groupApi;
    }

    protected async _handle(payload: GetGroupMemberInfoPayload): Promise<GroupMemberInfo> {
        const groupCode = String(payload.group_id);
        // user_id 是 uin：先 uin→uid，再查成员
        const uidMap = await this.groupApi.uinToUid([String(payload.user_id)]);
        const uid = uidMap.get(String(payload.user_id));
        if (uid === undefined) {
            throw new Error(`成员 ${payload.user_id} 不在群 ${payload.group_id}`);
        }
        const members = await this.groupApi.getGroupMemberInfo(groupCode, [uid]);
        const [member] = members;
        if (member === undefined) {
            throw new Error(`成员 ${payload.user_id} 不在群 ${payload.group_id}`);
        }
        const uinMap = await this.groupApi.uidToUin([uid]);
        return toOb11GroupMemberInfo(groupCode, member, uinMap);
    }
}
