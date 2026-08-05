/**
 * delete_friend 动作：删除好友（P2-11 接 kernel FriendApi.deleteFriend）
 */

import type { FriendApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const deleteFriendSchema = z.object({
    user_id: z.number(),
});

type DeleteFriendPayload = z.infer<typeof deleteFriendSchema>;

/** 删除好友（P2-11 接 kernel deleteFriend）。 */
export class DeleteFriendAction extends BaseAction<DeleteFriendPayload, null> {
    readonly name = "delete_friend";
    readonly schema = deleteFriendSchema;
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

    protected async _handle(payload: DeleteFriendPayload): Promise<null> {
        const uidMap = await this.deps.uinToUid([String(payload.user_id)]);
        const uid = uidMap.get(String(payload.user_id));
        if (uid === undefined) {
            throw new Error(`用户 ${payload.user_id} 的 uid 解析失败`);
        }
        await this.deps.friendApi.deleteFriend(uid);
        return null;
    }
}
