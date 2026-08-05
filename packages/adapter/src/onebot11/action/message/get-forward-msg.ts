/**
 * get_forward_msg 动作：获取合并转发内容（P2-12 接 kernel MsgApi.fetchForwardMessage）
 *
 * message_id / id → 反查 msgId + peer → fetchForwardMessage（getMultiMsg）→
 * 每条 toOb11MessageInfo → { messages }。
 */

import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import { toOb11MessageInfo } from "../../helper/index.js";
import { resolveMsgIdAndPeer } from "../../helper/message-unique.js";
import type { OB11MessageInfo } from "../../types/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getForwardMsgSchema = z.object({
    message_id: z.union([z.number(), z.string()]).optional(),
    id: z.union([z.number(), z.string()]).optional(),
});

type GetForwardMsgPayload = z.infer<typeof getForwardMsgSchema>;

/** 获取合并转发内容（P2-12 接 kernel fetchForwardMessage）。 */
export class GetForwardMsgAction extends BaseAction<
    GetForwardMsgPayload,
    { messages: OB11MessageInfo[] }
> {
    readonly name = "get_forward_msg";
    readonly schema = getForwardMsgSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: Pick<OneBotApi, "msgApi" | "messageUnique">;

    constructor(deps: Pick<OneBotApi, "msgApi" | "messageUnique">) {
        super();
        this.deps = deps;
    }

    protected async _handle(
        payload: GetForwardMsgPayload,
    ): Promise<{ messages: OB11MessageInfo[] }> {
        const id = payload.message_id ?? payload.id;
        if (id === undefined) {
            throw new Error("get_forward_msg 需要 message_id 或 id");
        }
        const { msgId, peer } = resolveMsgIdAndPeer(id, this.deps.messageUnique);
        const msgs = await this.deps.msgApi.fetchForwardMessage(peer, msgId);
        return {
            messages: msgs.map((msg) => toOb11MessageInfo(msg, this.deps.messageUnique)),
        };
    }
}
