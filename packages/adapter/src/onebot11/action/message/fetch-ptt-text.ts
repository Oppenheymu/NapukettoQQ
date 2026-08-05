/**
 * fetch_ptt_text 动作：获取语音转文字结果（NapCat 扩展，P2-10）
 *
 * message_id → msgId + peer → MsgApi.fetchPttText（内部：拉消息 → 找 PTT 元素
 * → translatePtt2Text → 再拉取读 pttElement.text）。
 */

import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import { resolveMsgIdAndPeer } from "../../helper/message-unique.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const fetchPttTextSchema = z.object({
    message_id: z.union([z.number(), z.string()]),
});

type FetchPttTextPayload = z.infer<typeof fetchPttTextSchema>;

/** 语音转文字依赖（OneBotApi 视图，由装配方注入）。 */
export type FetchPttTextDeps = Pick<OneBotApi, "msgApi" | "messageUnique">;

/** 获取语音转文字结果（P2-10 接 kernel fetchPttText）。 */
export class FetchPttTextAction extends BaseAction<FetchPttTextPayload, { text: string }> {
    readonly name = "fetch_ptt_text";
    readonly schema = fetchPttTextSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: FetchPttTextDeps;

    constructor(deps: FetchPttTextDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: FetchPttTextPayload): Promise<{ text: string }> {
        const { msgId, peer } = resolveMsgIdAndPeer(payload.message_id, this.deps.messageUnique);
        const text = await this.deps.msgApi.fetchPttText(msgId, peer);
        return { text };
    }
}
