/**
 * delete_msg 动作：撤回消息（P2-10 接 kernel MsgApi.recallMessage）
 *
 * OB11 标准 delete_msg 只有 message_id；peer 经 MessageUnique 反查。
 * 群聊管理员 / 私聊 2 分钟内可撤回。
 */

import type { MsgApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import type { MessageUnique } from "../helper/message-unique.js";
import { resolveMsgIdAndPeer } from "../helper/message-unique.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const deleteMsgSchema = z.object({
    message_id: z.union([z.number(), z.string()]),
});

type DeleteMsgPayload = z.infer<typeof deleteMsgSchema>;

/** 撤回消息依赖（由装配方注入）。 */
export interface DeleteMsgDeps {
    msgApi: MsgApi;
    messageUnique: MessageUnique;
}

/** 撤回消息（P2-10 接 kernel recallMessage）。 */
export class DeleteMsgAction extends BaseAction<DeleteMsgPayload, null> {
    readonly name = "delete_msg";
    readonly schema = deleteMsgSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: DeleteMsgDeps;

    constructor(deps: DeleteMsgDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: DeleteMsgPayload): Promise<null> {
        const { msgId, peer } = resolveMsgIdAndPeer(payload.message_id, this.deps.messageUnique);
        await this.deps.msgApi.recallMessage(peer, [msgId]);
        return null;
    }
}
