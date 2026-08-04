/**
 * get_group_info 动作：获取群信息
 *
 * 骨架实现：zod 校验 + 占位调用（P2 接入 kernel apis/group 后替换）。
 */

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

/** 获取群信息（P2 接入 kernel apis/group 后返回真实数据）。 */
export class GetGroupInfoAction extends BaseAction<GetGroupInfoPayload, GroupInfo> {
    readonly name = "get_group_info";
    readonly schema = getGroupInfoSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    protected _handle(_payload: GetGroupInfoPayload): Promise<GroupInfo> {
        // TODO(P2): 读 kernel 群缓存，缺则调 apis/group.getGroupInfo
        return Promise.reject(new Error("get_group_info 尚未接入 kernel（P2 实现）"));
    }
}
