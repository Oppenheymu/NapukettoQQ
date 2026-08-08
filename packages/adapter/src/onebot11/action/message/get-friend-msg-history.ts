/**
 * get_friend_msg_history 动作：获取私聊历史消息（NapCat 扩展，P2-10）
 *
 * user_id → uin→uid → Peer{ C2C } → fetchMessages → 数组翻译。
 */

import { ChatType } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OB11MessageInfo } from "../../types/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";
import { resolveUid } from "../resolve-uid.js";
import {
    fetchAndTranslateHistory,
    type MsgHistoryDeps,
    msgHistoryParamsSchema,
} from "./msg-history.js";

const getFriendMsgHistorySchema = z.object({
    user_id: z.number(),
    ...msgHistoryParamsSchema,
});

type GetFriendMsgHistoryPayload = z.infer<typeof getFriendMsgHistorySchema>;

/** 获取私聊历史消息（P2-10 接 kernel fetchMessages）。 */
export class GetFriendMsgHistoryAction extends BaseAction<
    GetFriendMsgHistoryPayload,
    { messages: OB11MessageInfo[] }
> {
    readonly name = "get_friend_msg_history";
    readonly schema = getFriendMsgHistorySchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: MsgHistoryDeps & {
        uinToUid: (uins: string[]) => Promise<Map<string, string>>;
    };

    constructor(
        deps: MsgHistoryDeps & { uinToUid: (uins: string[]) => Promise<Map<string, string>> },
    ) {
        super();
        this.deps = deps;
    }

    protected async _handle(
        payload: GetFriendMsgHistoryPayload,
    ): Promise<{ messages: OB11MessageInfo[] }> {
        const uid = await resolveUid(String(payload.user_id), this.deps.uinToUid);
        const peer = { chatType: ChatType.C2C, peerUid: uid };
        return await fetchAndTranslateHistory(peer, payload.message_seq, payload.count, this.deps);
    }
}
