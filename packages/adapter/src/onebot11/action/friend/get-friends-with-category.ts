/**
 * get_friends_with_category 动作：获取好友列表（含分类，NapCat 扩展，P2-11）
 *
 * 返回分类结构：categoryId / categorySortId / categoryName / categoryMbCount /
 * onlineCount / buddyList（Friend[]：uin/nickname/remark）。
 */

import type { FriendApi, FriendCategory } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getFriendsWithCategorySchema = z.object({});

type GetFriendsWithCategoryPayload = z.infer<typeof getFriendsWithCategorySchema>;

/** 获取好友列表（含分类，P2-11 接 kernel getFriendCategories）。 */
export class GetFriendsWithCategoryAction extends BaseAction<
    GetFriendsWithCategoryPayload,
    FriendCategory[]
> {
    readonly name = "get_friends_with_category";
    readonly schema = getFriendsWithCategorySchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly friendApi: FriendApi;

    constructor(friendApi: FriendApi) {
        super();
        this.friendApi = friendApi;
    }

    protected _handle(_payload: GetFriendsWithCategoryPayload): Promise<FriendCategory[]> {
        return this.friendApi.getFriendCategories();
    }
}
