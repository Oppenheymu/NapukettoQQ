/**
 * get_friend_msg_history 动作：获取私聊历史消息（NapCat 扩展，P2-10）
 *
 * user_id → uin→uid → Peer{ C2C } → fetchMessages → 数组翻译。
 */

import { ChatType, kernelError, toCanonicalElements } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import {
    collectReceiveNeeds,
    type ReceiveTranslateContext,
    toOb11MessageInfo,
} from "../../helper/index.js";
import type { OB11MessageInfo } from "../../types/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";
import type { MsgHistoryDeps } from "./get-group-msg-history.js";

/** 默认历史消息条数。 */
const DEFAULT_HISTORY_COUNT = 20;

const getFriendMsgHistorySchema = z.object({
    user_id: z.number(),
    message_seq: z.union([z.number(), z.string()]).optional(),
    count: z.number().default(DEFAULT_HISTORY_COUNT),
    reverse_order: z.boolean().optional(),
    reverseOrder: z.boolean().optional(),
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
        const uidMap = await this.deps.uinToUid([String(payload.user_id)]);
        const uid = uidMap.get(String(payload.user_id));
        if (uid === undefined) {
            throw kernelError(`用户 ${payload.user_id} 的 uid 解析失败`, "INVALID_PARAM");
        }
        const peer = { chatType: ChatType.C2C, peerUid: uid };
        let startMsgId: string | undefined;
        if (payload.message_seq !== undefined) {
            const raw = String(payload.message_seq);
            const shortId = Number(raw);
            if (Number.isFinite(shortId)) {
                startMsgId = this.deps.messageUnique.getMsgId(shortId);
            }
            startMsgId ??= raw;
        }
        const opts: { count: number; msgId?: string } = { count: payload.count };
        if (startMsgId !== undefined) {
            opts.msgId = startMsgId;
        }
        const msgs = await this.deps.msgApi.fetchMessages(peer, opts);
        if (msgs.length === 0) {
            throw kernelError(`消息 ${payload.message_seq ?? "0"} 不存在`, "NOT_FOUND");
        }
        // P2-19：收集全部消息 at uid → 一次批量 uidToUin → 上下文注入
        const atUids = new Set<string>();
        for (const m of msgs) {
            const { atUids: uids } = collectReceiveNeeds(toCanonicalElements(m));
            for (const u of uids) {
                atUids.add(u);
            }
        }
        let uidToUin: Map<string, string> | undefined;
        if (atUids.size > 0) {
            try {
                uidToUin = await this.deps.uidToUin([...atUids]);
            } catch {
                // uid 解析失败：at 原样（uid）
            }
        }
        const ctx: ReceiveTranslateContext = {
            ...(uidToUin !== undefined ? { uidToUin } : {}),
            msgIdToOb11Id: (m) => this.deps.messageUnique.getMessageId(m),
        };
        return {
            messages: msgs.map((msg) => toOb11MessageInfo(msg, this.deps.messageUnique, ctx)),
        };
    }
}
