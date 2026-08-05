/**
 * get_doubt_friends_add_request 动作：获取可疑好友申请（NapCat 扩展，P2-11）
 */

import type { DoubtFriendRequestInfo, FriendApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getDoubtFriendsAddRequestSchema = z.object({
    count: z.number().optional(),
});

type GetDoubtFriendsAddRequestPayload = z.infer<typeof getDoubtFriendsAddRequestSchema>;

/** 默认获取数量。 */
const DEFAULT_COUNT = 50;

/** 获取可疑好友申请（P2-11 接 kernel getDoubtFriendRequest）。 */
export class GetDoubtFriendsAddRequestAction extends BaseAction<
    GetDoubtFriendsAddRequestPayload,
    DoubtFriendRequestInfo[]
> {
    readonly name = "get_doubt_friends_add_request";
    readonly schema = getDoubtFriendsAddRequestSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly friendApi: FriendApi;

    constructor(friendApi: FriendApi) {
        super();
        this.friendApi = friendApi;
    }

    protected _handle(
        payload: GetDoubtFriendsAddRequestPayload,
    ): Promise<DoubtFriendRequestInfo[]> {
        return this.friendApi.getDoubtFriendRequest(payload.count ?? DEFAULT_COUNT);
    }
}
