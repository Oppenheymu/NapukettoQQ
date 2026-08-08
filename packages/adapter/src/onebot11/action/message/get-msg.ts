/**
 * get_msg 动作：获取消息详情（P2-10 接 kernel MsgApi.fetchMsgsByMsgId）
 *
 * message_id → msgId + peer（MessageUnique 反查）→ 拉消息 → OB11 消息信息结构。
 */

import { toCanonicalElements } from "@napuketto/kernel";
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
import { fetchMsgById } from "./resolve-peer.js";

const getMsgSchema = z.object({
    message_id: z.union([z.number(), z.string()]),
});

type GetMsgPayload = z.infer<typeof getMsgSchema>;

/** get_msg 依赖（OneBotApi 视图，由装配方注入）。 */
export type GetMsgDeps = Pick<OneBotApi, "msgApi" | "messageUnique" | "uidToUin">;

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
        const { msg } = await fetchMsgById(
            payload.message_id,
            this.deps.messageUnique,
            this.deps.msgApi,
        );
        // P2-19：收集 at uid → 批量 uidToUin → 上下文注入（at uid→uin、reply 映射）
        const elements = toCanonicalElements(msg);
        const { atUids } = collectReceiveNeeds(elements);
        let uidToUin: Map<string, string> | undefined;
        if (atUids.length > 0) {
            try {
                uidToUin = await this.deps.uidToUin(atUids);
            } catch {
                // uid 解析失败：at 原样（uid）
            }
        }
        const ctx: ReceiveTranslateContext = {
            ...(uidToUin !== undefined ? { uidToUin } : {}),
            msgIdToOb11Id: (m) => this.deps.messageUnique.getMessageId(m),
        };
        return toOb11MessageInfo(msg, this.deps.messageUnique, ctx);
    }
}
