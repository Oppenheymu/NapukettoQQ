/**
 * set_doubt_friends_add_request 动作：处理可疑好友申请（NapCat 扩展，P2-11）
 *
 * flag=uid（get_doubt_friends_add_request 返回的 flag）→ handleDoubtFriendRequest。
 * approve 字段 NapCat 强制为 true（该接口无语义，仅保留）。
 */

import type { FriendApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const setDoubtFriendsAddRequestSchema = z.object({
    flag: z.string(),
    approve: z.boolean().optional(),
});

type SetDoubtFriendsAddRequestPayload = z.infer<typeof setDoubtFriendsAddRequestSchema>;

/** 处理可疑好友申请（P2-11 接 kernel handleDoubtFriendRequest）。 */
export class SetDoubtFriendsAddRequestAction extends BaseAction<
    SetDoubtFriendsAddRequestPayload,
    null
> {
    readonly name = "set_doubt_friends_add_request";
    readonly schema = setDoubtFriendsAddRequestSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly friendApi: FriendApi;

    constructor(friendApi: FriendApi) {
        super();
        this.friendApi = friendApi;
    }

    protected _handle(payload: SetDoubtFriendsAddRequestPayload): Promise<null> {
        this.friendApi.handleDoubtFriendRequest(payload.flag);
        return Promise.resolve(null);
    }
}
