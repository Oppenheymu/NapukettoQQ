/**
 * set_essence_msg 动作：设置精华消息（P2-10 接 kernel GroupApi.addGroupEssence）
 *
 * message_id → msgId + peer（MessageUnique 反查，需群消息）→ addGroupEssence。
 */

import type { GroupApi } from "@napuketto/kernel";
import { ChatType } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { MessageUnique } from "../../helper/message-unique.js";
import { resolveMsgIdAndPeer } from "../../helper/message-unique.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const setEssenceMsgSchema = z.object({
    message_id: z.union([z.number(), z.string()]),
});

type SetEssenceMsgPayload = z.infer<typeof setEssenceMsgSchema>;

/** 精华消息依赖（由装配方注入）。 */
export interface EssenceMsgDeps {
    groupApi: GroupApi;
    messageUnique: MessageUnique;
}

/** 设置精华消息（P2-10 接 kernel addGroupEssence）。 */
export class SetEssenceMsgAction extends BaseAction<SetEssenceMsgPayload, null> {
    readonly name = "set_essence_msg";
    readonly schema = setEssenceMsgSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: EssenceMsgDeps;

    constructor(deps: EssenceMsgDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: SetEssenceMsgPayload): Promise<null> {
        const { msgId, peer } = resolveMsgIdAndPeer(payload.message_id, this.deps.messageUnique);
        if (peer.chatType !== ChatType.GROUP) {
            throw new Error("精华消息仅支持群聊消息");
        }
        await this.deps.groupApi.addGroupEssence(peer.peerUid, msgId);
        return null;
    }
}
