/**
 * set_friend_remark 动作：设置好友备注（P2-11 接 kernel FriendApi.setFriendRemark）
 */

import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import { ob11ErrorCodeMap } from "../error-map.js";
import { resolveUid } from "../resolve-uid.js";

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

    private readonly deps: Pick<OneBotApi, "friendApi" | "uinToUid">;

    constructor(deps: Pick<OneBotApi, "friendApi" | "uinToUid">) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: SetFriendRemarkPayload): Promise<null> {
        const uid = await resolveUid(String(payload.user_id), this.deps.uinToUid);
        this.deps.friendApi.setFriendRemark(uid, payload.remark);
        return null;
    }
}
