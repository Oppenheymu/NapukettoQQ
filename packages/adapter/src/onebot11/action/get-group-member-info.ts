/**
 * get_group_member_info 动作：获取群成员信息
 *
 * 骨架实现：zod 校验 + 占位调用（P2 接入 kernel apis/group + 缓存后替换）。
 */

import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import type { GroupMemberInfo } from "../types/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const getGroupMemberInfoSchema = z.object({
    group_id: z.number(),
    user_id: z.number(),
    /** 是否忽略缓存（go-cqhttp 扩展）。 */
    no_cache: z.boolean().optional(),
});

type GetGroupMemberInfoPayload = z.infer<typeof getGroupMemberInfoSchema>;

/** 获取群成员信息（P2 接入 kernel 成员缓存后返回真实数据）。 */
export class GetGroupMemberInfoAction extends BaseAction<
    GetGroupMemberInfoPayload,
    GroupMemberInfo
> {
    readonly name = "get_group_member_info";
    readonly schema = getGroupMemberInfoSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    protected _handle(_payload: GetGroupMemberInfoPayload): Promise<GroupMemberInfo> {
        // TODO(P2): 读 kernel 成员缓存，缺则惰性拉取（ADR-008）
        return Promise.reject(new Error("get_group_member_info 尚未接入 kernel（P2 实现）"));
    }
}
