/**
 * get_friend_list 动作：获取好友列表（P2-4 接 kernel FriendApi）
 */

import type { FriendApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { FriendInfo } from "../../types/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getFriendListSchema = z.object({
    /** 是否忽略缓存（go-cqhttp 扩展）。 */
    no_cache: z.boolean().optional(),
});

type GetFriendListPayload = z.infer<typeof getFriendListSchema>;

/** 获取好友列表（P2-4 接 kernel apis/friend）。 */
export class GetFriendListAction extends BaseAction<GetFriendListPayload, FriendInfo[]> {
    readonly name = "get_friend_list";
    readonly schema = getFriendListSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly friendApi: FriendApi;

    constructor(friendApi: FriendApi) {
        super();
        this.friendApi = friendApi;
    }

    protected async _handle(_payload: GetFriendListPayload): Promise<FriendInfo[]> {
        const friends = await this.friendApi.getFriendList();
        return friends.map((f) => {
            const info: FriendInfo = {
                user_id: Number(f.uin),
                nickname: f.nickname,
            };
            if (f.remark !== "") {
                info.remark = f.remark;
            }
            return info;
        });
    }
}
