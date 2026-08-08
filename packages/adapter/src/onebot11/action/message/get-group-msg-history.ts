/**
 * get_group_msg_history 动作：获取群历史消息（go-cqhttp 扩展，P2-10）
 *
 * group_id → Peer{ GROUP } → MsgApi.fetchMessages（message_seq 起，count 条）
 * → 数组翻译为 OB11 消息信息。
 */

import { ChatType } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OB11MessageInfo } from "../../types/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";
import {
    fetchAndTranslateHistory,
    type MsgHistoryDeps,
    msgHistoryParamsSchema,
} from "./msg-history.js";

const getGroupMsgHistorySchema = z.object({
    group_id: z.number(),
    ...msgHistoryParamsSchema,
});

type GetGroupMsgHistoryPayload = z.infer<typeof getGroupMsgHistorySchema>;

/** 获取群历史消息（P2-10 接 kernel fetchMessages）。 */
export class GetGroupMsgHistoryAction extends BaseAction<
    GetGroupMsgHistoryPayload,
    { messages: OB11MessageInfo[] }
> {
    readonly name = "get_group_msg_history";
    readonly schema = getGroupMsgHistorySchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: MsgHistoryDeps;

    constructor(deps: MsgHistoryDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(
        payload: GetGroupMsgHistoryPayload,
    ): Promise<{ messages: OB11MessageInfo[] }> {
        const peer = { chatType: ChatType.GROUP, peerUid: String(payload.group_id) };
        return await fetchAndTranslateHistory(peer, payload.message_seq, payload.count, this.deps);
    }
}
