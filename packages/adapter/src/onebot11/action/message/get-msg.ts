/**
 * get_msg 动作：获取消息详情（P2-10 接 kernel MsgApi.fetchMsgsByMsgId）
 *
 * message_id → msgId + peer（MessageUnique 反查）→ 拉消息 → OB11 消息信息结构。
 */

import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import { toOb11MessageInfo } from "../../helper/index.js";
import { resolveMsgIdAndPeer } from "../../helper/message-unique.js";
import type { OB11MessageInfo } from "../../types/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getMsgSchema = z.object({
    message_id: z.union([z.number(), z.string()]),
});

type GetMsgPayload = z.infer<typeof getMsgSchema>;

/** get_msg 依赖（OneBotApi 视图，由装配方注入）。 */
export type GetMsgDeps = Pick<OneBotApi, "msgApi" | "messageUnique">;

/** 获取消息详情（P2-10 接 kernel fetchMsgsByMsgId）。 */
export class GetMsgAction extends BaseAction<GetMsgPayload, OB11MessageInfo> {
    readonly name = "get_msg";
    readonly schema = getMsgSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: GetMsgDeps;

    constructor(deps: GetMsgDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: GetMsgPayload): Promise<OB11MessageInfo> {
        const { msgId, peer } = resolveMsgIdAndPeer(payload.message_id, this.deps.messageUnique);
        const msgs = await this.deps.msgApi.fetchMsgsByMsgId(peer, [msgId]);
        const [msg] = msgs;
        if (msg === undefined) {
            throw new Error(`消息 ${payload.message_id} 不存在或已被撤回`);
        }
        return toOb11MessageInfo(msg, this.deps.messageUnique);
    }
}
