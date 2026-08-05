/**
 * set_friend_add_request 动作：处理加好友请求（P2-11）
 *
 * flag=reqTime（NapCat 约定，需从好友请求事件上报中获取）→ getBuddyReqList
 * 匹配 → handleFriendRequest(notify, approve) + optional remark。
 */

import type { FriendApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const setFriendAddRequestSchema = z.object({
    flag: z.string(),
    approve: z.boolean().optional(),
    remark: z.string().optional(),
});

type SetFriendAddRequestPayload = z.infer<typeof setFriendAddRequestSchema>;

/** 处理加好友请求（P2-11 接 kernel FriendApi）。 */
export class SetFriendAddRequestAction extends BaseAction<SetFriendAddRequestPayload, null> {
    readonly name = "set_friend_add_request";
    readonly schema = setFriendAddRequestSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly friendApi: FriendApi;

    constructor(friendApi: FriendApi) {
        super();
        this.friendApi = friendApi;
    }

    protected async _handle(payload: SetFriendAddRequestPayload): Promise<null> {
        const list = await this.friendApi.getBuddyReqList();
        const notify = list.find((req) => req.reqTime === payload.flag);
        if (notify === undefined) {
            throw new Error("未找到对应的好友请求（flag 无效或已过期）");
        }
        await this.friendApi.handleFriendRequest(notify, payload.approve !== false);
        if (payload.remark !== undefined) {
            this.friendApi.setFriendRemark(notify.friendUid, payload.remark);
        }
        return null;
    }
}
