/**
 * get_group_list 动作：获取群列表
 *
 * 骨架实现：zod 校验 + 占位调用（P2 接入 kernel apis/group 后替换）。
 */

import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import type { GroupInfo } from "../types/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const getGroupListSchema = z.object({
    /** 是否忽略缓存（go-cqhttp 扩展）。 */
    no_cache: z.boolean().optional(),
});

type GetGroupListPayload = z.infer<typeof getGroupListSchema>;

/** 获取群列表（P2 接入 kernel apis/group 后返回真实数据）。 */
export class GetGroupListAction extends BaseAction<GetGroupListPayload, GroupInfo[]> {
    readonly name = "get_group_list";
    readonly schema = getGroupListSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    protected _handle(_payload: GetGroupListPayload): Promise<GroupInfo[]> {
        // TODO(P2): 读 kernel 群缓存（ADR-008：缓存主动同步 + 只读消费）
        return Promise.reject(new Error("get_group_list 尚未接入 kernel（P2 实现）"));
    }
}
