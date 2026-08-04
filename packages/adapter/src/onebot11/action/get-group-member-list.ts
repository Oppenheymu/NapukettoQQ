/**
 * get_group_member_list 动作：获取群成员列表
 *
 * 骨架实现：zod 校验 + 占位调用（P2 接入 kernel apis/group + 缓存后替换）。
 */

import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import type { GroupMemberInfo } from "../types/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const getGroupMemberListSchema = z.object({
    group_id: z.number(),
    /** 是否忽略缓存（go-cqhttp 扩展）。 */
    no_cache: z.boolean().optional(),
});

type GetGroupMemberListPayload = z.infer<typeof getGroupMemberListSchema>;

/** 获取群成员列表（P2 接入 kernel 成员缓存后返回真实数据）。 */
export class GetGroupMemberListAction extends BaseAction<
    GetGroupMemberListPayload,
    GroupMemberInfo[]
> {
    readonly name = "get_group_member_list";
    readonly schema = getGroupMemberListSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    protected _handle(_payload: GetGroupMemberListPayload): Promise<GroupMemberInfo[]> {
        // TODO(P2): 读 kernel 成员缓存（ADR-008：只读消费）
        return Promise.reject(new Error("get_group_member_list 尚未接入 kernel（P2 实现）"));
    }
}
