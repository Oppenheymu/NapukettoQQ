/**
 * forward_group_single_msg / forward_friend_single_msg 动作：单条转发（P2-12）
 *
 * message_id 反查源 msgId + peer；group_id/user_id 为目标 →
 * MsgApi.forwardSingleMessage(srcPeer, [msgId], dstPeer)。
 */

import type { Peer } from "@napuketto/kernel";
import { ChatType } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import { resolveMsgIdAndPeer } from "../../helper/message-unique.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const forwardSingleMsgSchema = z.object({
    message_id: z.union([z.number(), z.string()]),
    group_id: z.number().optional(),
    user_id: z.number().optional(),
});

type ForwardSingleMsgPayload = z.infer<typeof forwardSingleMsgSchema>;

/** 单条转发依赖（OneBotApi 视图，由装配方注入）。 */
export type ForwardSingleMsgDeps = Pick<OneBotApi, "msgApi" | "messageUnique" | "uinToUid">;

/** 解析目标 Peer（group_id 直通；user_id 经 uin→uid）。 */
async function resolveTargetPeer(
    payload: ForwardSingleMsgPayload,
    deps: ForwardSingleMsgDeps,
): Promise<Peer> {
    if (payload.group_id !== undefined) {
        return { chatType: ChatType.GROUP, peerUid: String(payload.group_id) };
    }
    if (payload.user_id !== undefined) {
        const uidMap = await deps.uinToUid([String(payload.user_id)]);
        const uid = uidMap.get(String(payload.user_id));
        if (uid === undefined) {
            throw new Error(`用户 ${payload.user_id} 的 uid 解析失败`);
        }
        return { chatType: ChatType.C2C, peerUid: uid };
    }
    throw new Error("单条转发需要 group_id 或 user_id");
}

/** 单条转发基类（两个动作共用实现）。 */
abstract class ForwardSingleMsgBase extends BaseAction<ForwardSingleMsgPayload, null> {
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: ForwardSingleMsgDeps;

    constructor(deps: ForwardSingleMsgDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: ForwardSingleMsgPayload): Promise<null> {
        const { msgId, peer: sourcePeer } = resolveMsgIdAndPeer(
            payload.message_id,
            this.deps.messageUnique,
        );
        const dstPeer = await resolveTargetPeer(payload, this.deps);
        await this.deps.msgApi.forwardSingleMessage(sourcePeer, [msgId], dstPeer);
        return null;
    }
}

/** 转发单条消息到群（P2-12）。 */
export class ForwardGroupSingleMsgAction extends ForwardSingleMsgBase {
    readonly name = "forward_group_single_msg";
    readonly schema = forwardSingleMsgSchema;
}

/** 转发单条消息到好友（P2-12）。 */
export class ForwardFriendSingleMsgAction extends ForwardSingleMsgBase {
    readonly name = "forward_friend_single_msg";
    readonly schema = forwardSingleMsgSchema;
}
