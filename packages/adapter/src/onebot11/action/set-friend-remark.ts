/**
 * set_friend_remark 动作：设置好友备注（P2-11 接 kernel FriendApi.setFriendRemark）
 */

import type { FriendApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const setFriendRemarkSchema = z.object({
    user_id: z.number(),
    remark: z.string(),
});

type SetFriendRemarkPayload = z.infer<typeof setFriendRemarkSchema>;

/** 设置好友备注（P2-11 接 kernel setFriendRemark）。 */
export class SetFriendRemarkAction extends BaseAction<SetFriendRemarkPayload, null> {
    readonly name = "set_friend_remark";
    readonly schema = setFriendRemarkSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: {
        friendApi: FriendApi;
        uinToUid: (uins: string[]) => Promise<Map<string, string>>;
    };

    constructor(deps: {
        friendApi: FriendApi;
        uinToUid: (uins: string[]) => Promise<Map<string, string>>;
    }) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: SetFriendRemarkPayload): Promise<null> {
        const uid = await this.resolveUid(payload.user_id);
        this.deps.friendApi.setFriendRemark(uid, payload.remark);
        return null;
    }

    /** user_id（uin）→ uid。 */
    private async resolveUid(userId: number): Promise<string> {
        const uidMap = await this.deps.uinToUid([String(userId)]);
        const uid = uidMap.get(String(userId));
        if (uid === undefined) {
            throw new Error(`用户 ${userId} 的 uid 解析失败`);
        }
        return uid;
    }
}
