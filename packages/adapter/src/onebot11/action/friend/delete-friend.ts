/**
 * delete_friend 动作：删除好友（P2-11 接 kernel FriendApi.deleteFriend）
 */

import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import { ob11ErrorCodeMap } from "../error-map.js";
import { resolveUid } from "../resolve-uid.js";

const deleteFriendSchema = z.object({
    user_id: z.number(),
});

type DeleteFriendPayload = z.infer<typeof deleteFriendSchema>;

/** 删除好友（P2-11 接 kernel deleteFriend）。 */
export class DeleteFriendAction extends BaseAction<DeleteFriendPayload, null> {
    readonly name = "delete_friend";
    readonly schema = deleteFriendSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: Pick<OneBotApi, "friendApi" | "uinToUid">;

    constructor(deps: Pick<OneBotApi, "friendApi" | "uinToUid">) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: DeleteFriendPayload): Promise<null> {
        const uid = await resolveUid(String(payload.user_id), this.deps.uinToUid);
        await this.deps.friendApi.deleteFriend(uid);
        return null;
    }
}
