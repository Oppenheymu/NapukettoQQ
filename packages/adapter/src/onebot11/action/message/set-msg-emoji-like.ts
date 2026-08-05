/**
 * set_msg_emoji_like 动作：消息表情表态（NapCat 扩展，P2-10）
 *
 * message_id → msgId + peer → 拉消息取 msgSeq → MsgApi.setMsgEmojiLike。
 */

import type { MsgApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { MessageUnique } from "../../helper/message-unique.js";
import { resolveMsgIdAndPeer } from "../../helper/message-unique.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const setMsgEmojiLikeSchema = z.object({
    message_id: z.union([z.number(), z.string()]),
    /** 表情 ID（如 105 点赞）。 */
    emoji_id: z.number(),
    /** 表情类型（默认 1）。 */
    emoji_type: z.number().optional(),
    /** 是否点赞（false 取消）。 */
    like: z.boolean().optional(),
});

type SetMsgEmojiLikePayload = z.infer<typeof setMsgEmojiLikeSchema>;

/** 表情表态依赖（由装配方注入）。 */
export interface SetMsgEmojiLikeDeps {
    msgApi: MsgApi;
    messageUnique: MessageUnique;
}

/** 消息表情表态（P2-10 接 kernel setMsgEmojiLike）。 */
export class SetMsgEmojiLikeAction extends BaseAction<SetMsgEmojiLikePayload, null> {
    readonly name = "set_msg_emoji_like";
    readonly schema = setMsgEmojiLikeSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: SetMsgEmojiLikeDeps;

    constructor(deps: SetMsgEmojiLikeDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: SetMsgEmojiLikePayload): Promise<null> {
        const { msgId, peer } = resolveMsgIdAndPeer(payload.message_id, this.deps.messageUnique);
        // msgSeq 需从消息本体取
        const msgs = await this.deps.msgApi.fetchMsgsByMsgId(peer, [msgId]);
        const [msg] = msgs;
        if (msg === undefined) {
            throw new Error(`消息 ${payload.message_id} 不存在或已被撤回`);
        }
        await this.deps.msgApi.setMsgEmojiLike(peer, {
            msgSeq: msg.msgSeq,
            emojiId: String(payload.emoji_id),
            emojiType: String(payload.emoji_type ?? 1),
            like: payload.like ?? true,
        });
        return null;
    }
}
