/**
 * get_friend_list 动作：获取好友列表
 *
 * 骨架实现：zod 校验 + 占位调用（P2 接入 kernel apis/friend + 缓存后替换）。
 */

import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import type { FriendInfo } from "../types/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const getFriendListSchema = z.object({
    /** 是否忽略缓存（go-cqhttp 扩展）。 */
    no_cache: z.boolean().optional(),
});

type GetFriendListPayload = z.infer<typeof getFriendListSchema>;

/** 获取好友列表（P2 接入 kernel 好友缓存后返回真实数据）。 */
export class GetFriendListAction extends BaseAction<GetFriendListPayload, FriendInfo[]> {
    readonly name = "get_friend_list";
    readonly schema = getFriendListSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    protected _handle(_payload: GetFriendListPayload): Promise<FriendInfo[]> {
        // TODO(P2): 读 kernel 好友缓存（ADR-008：只读消费）
        return Promise.reject(new Error("get_friend_list 尚未接入 kernel（P2 实现）"));
    }
}
