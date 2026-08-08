/**
 * set_essence_msg 动作：设置精华消息（P2-10 接 kernel GroupApi.addGroupEssence）
 *
 * message_id → msgId + peer（MessageUnique 反查，需群消息）→ addGroupEssence。
 */

import { ChatType, kernelError } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import { resolveMsgIdAndPeer } from "../../helper/message-unique.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const setEssenceMsgSchema = z.object({
    message_id: z.union([z.number(), z.string()]),
});

/** 精华消息依赖（OneBotApi 视图，由装配方注入）。 */
export type EssenceMsgDeps = Pick<OneBotApi, "groupApi" | "messageUnique">;

/** 精华消息基类（set/delete 共用实现，2026-08-08 克隆合并）。 */
export abstract class EssenceMsgBase extends BaseAction<{ message_id: number | string }, null> {
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    protected readonly deps: EssenceMsgDeps;

    constructor(deps: EssenceMsgDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: { message_id: number | string }): Promise<null> {
        const { msgId, peer } = resolveMsgIdAndPeer(payload.message_id, this.deps.messageUnique);
        if (peer.chatType !== ChatType.GROUP) {
            throw kernelError("精华消息仅支持群聊消息", "INVALID_PARAM");
        }
        await this.operate(peer.peerUid, msgId);
        return null;
    }

    /** 具体精华操作（子类实现：addGroupEssence / removeGroupEssence）。 */
    protected abstract operate(groupCode: string, msgId: string): Promise<void>;
}

/** 设置精华消息（P2-10 接 kernel addGroupEssence）。 */
export class SetEssenceMsgAction extends EssenceMsgBase {
    readonly name = "set_essence_msg";
    readonly schema = setEssenceMsgSchema;

    constructor(deps: EssenceMsgDeps) {
        super(deps);
    }

    protected async operate(groupCode: string, msgId: string): Promise<void> {
        await this.deps.groupApi.addGroupEssence(groupCode, msgId);
    }
}
