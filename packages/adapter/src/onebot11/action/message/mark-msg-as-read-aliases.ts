/**
 * mark_private_msg_as_read / mark_group_msg_as_read 动作：标记会话已读（P2-13）
 *
 * mark_msg_as_read 的细分别名（NapCat 扩展）：
 * - mark_private_msg_as_read：user_id → C2C markRead
 * - mark_group_msg_as_read：group_id → GROUP markRead
 */

import { ChatType, kernelError } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const markPrivateMsgAsReadSchema = z.object({
    user_id: z.number(),
});

type MarkPrivateMsgAsReadPayload = z.infer<typeof markPrivateMsgAsReadSchema>;

const markGroupMsgAsReadSchema = z.object({
    group_id: z.number(),
});

type MarkGroupMsgAsReadPayload = z.infer<typeof markGroupMsgAsReadSchema>;

/** 标记已读依赖（msgApi + uinToUid，OneBotApi 视图）。 */
export type MarkReadAliasDeps = Pick<OneBotApi, "msgApi" | "uinToUid">;

/** 标记私聊已读（P2-13）。 */
export class MarkPrivateMsgAsReadAction extends BaseAction<MarkPrivateMsgAsReadPayload, null> {
    readonly name = "mark_private_msg_as_read";
    readonly schema = markPrivateMsgAsReadSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: MarkReadAliasDeps;

    constructor(deps: MarkReadAliasDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: MarkPrivateMsgAsReadPayload): Promise<null> {
        const uidMap = await this.deps.uinToUid([String(payload.user_id)]);
        const uid = uidMap.get(String(payload.user_id));
        if (uid === undefined) {
            throw kernelError(`用户 ${payload.user_id} 的 uid 解析失败`, "INVALID_PARAM");
        }
        await this.deps.msgApi.markRead({ chatType: ChatType.C2C, peerUid: uid });
        return null;
    }
}

/** 标记群聊已读（P2-13）。 */
export class MarkGroupMsgAsReadAction extends BaseAction<MarkGroupMsgAsReadPayload, null> {
    readonly name = "mark_group_msg_as_read";
    readonly schema = markGroupMsgAsReadSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: Pick<OneBotApi, "msgApi">;

    constructor(deps: Pick<OneBotApi, "msgApi">) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: MarkGroupMsgAsReadPayload): Promise<null> {
        await this.deps.msgApi.markRead({
            chatType: ChatType.GROUP,
            peerUid: String(payload.group_id),
        });
        return null;
    }
}
