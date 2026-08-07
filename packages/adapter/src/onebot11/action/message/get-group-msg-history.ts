/**
 * get_group_msg_history 动作：获取群历史消息（go-cqhttp 扩展，P2-10）
 *
 * group_id → Peer{ GROUP } → MsgApi.fetchMessages（message_seq 起，count 条）
 * → 数组翻译为 OB11 消息信息。
 */

import { ChatType, kernelError, toCanonicalElements } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import {
    collectReceiveNeeds,
    type ReceiveTranslateContext,
    toOb11MessageInfo,
} from "../../helper/index.js";
import type { OB11MessageInfo } from "../../types/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

/** 默认历史消息条数。 */
const DEFAULT_HISTORY_COUNT = 20;

const getGroupMsgHistorySchema = z.object({
    group_id: z.number(),
    /** 起始消息序号（message_seq，缺省从最新拉）。 */
    message_seq: z.union([z.number(), z.string()]).optional(),
    count: z.number().default(DEFAULT_HISTORY_COUNT),
    /** 是否反向排序（NapCat 扩展）。 */
    reverse_order: z.boolean().optional(),
    reverseOrder: z.boolean().optional(),
});

type GetGroupMsgHistoryPayload = z.infer<typeof getGroupMsgHistorySchema>;

/** 历史消息依赖（OneBotApi 视图，由装配方注入）。 */
export type MsgHistoryDeps = Pick<OneBotApi, "msgApi" | "messageUnique" | "uidToUin">;

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
        // message_seq 为 OB11 message_id（int32）时经 MessageUnique 反查起始 msgId
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
