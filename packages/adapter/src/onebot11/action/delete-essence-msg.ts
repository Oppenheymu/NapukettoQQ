/**
 * delete_essence_msg 动作：取消精华消息（P2-10 接 kernel GroupApi.removeGroupEssence）
 */

import { ChatType } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import { resolveMsgIdAndPeer } from "../helper/message-unique.js";
import { ob11ErrorCodeMap } from "./error-map.js";
import type { EssenceMsgDeps } from "./set-essence-msg.js";

const deleteEssenceMsgSchema = z.object({
    message_id: z.union([z.number(), z.string()]),
});

type DeleteEssenceMsgPayload = z.infer<typeof deleteEssenceMsgSchema>;

/** 取消精华消息（P2-10 接 kernel removeGroupEssence）。 */
export class DeleteEssenceMsgAction extends BaseAction<DeleteEssenceMsgPayload, null> {
    readonly name = "delete_essence_msg";
    readonly schema = deleteEssenceMsgSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: EssenceMsgDeps;

    constructor(deps: EssenceMsgDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: DeleteEssenceMsgPayload): Promise<null> {
        const { msgId, peer } = resolveMsgIdAndPeer(payload.message_id, this.deps.messageUnique);
        if (peer.chatType !== ChatType.GROUP) {
            throw new Error("精华消息仅支持群聊消息");
        }
        await this.deps.groupApi.removeGroupEssence(peer.peerUid, msgId);
        return null;
    }
}
