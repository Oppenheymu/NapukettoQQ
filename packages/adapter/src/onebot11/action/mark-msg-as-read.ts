/**
 * mark_msg_as_read 动作：标记消息已读（P2-10 接 kernel MsgApi.markRead）
 *
 * OB11 标准 mark_msg_as_read 以 user_id 为参数；NapCat 扩展同时支持 group_id
 * （mark_private_msg_as_read / mark_group_msg_as_read 由 adapter 层同名动作或
 * 语义别名处理）。user_id → C2C peer；group_id → GROUP peer。
 */

import type { MsgApi } from "@napuketto/kernel";
import { ChatType } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const markMsgAsReadSchema = z
    .object({
        user_id: z.number().optional(),
        group_id: z.number().optional(),
    })
    .refine((v) => v.user_id !== undefined || v.group_id !== undefined, {
        message: "mark_msg_as_read 需要 user_id 或 group_id",
    });

type MarkMsgAsReadPayload = z.infer<typeof markMsgAsReadSchema>;

/** 标记已读依赖（由装配方注入）。 */
export interface MarkReadDeps {
    msgApi: MsgApi;
    uinToUid: (uins: string[]) => Promise<Map<string, string>>;
}

/** 标记消息已读（P2-10 接 kernel markRead）。 */
export class MarkMsgAsReadAction extends BaseAction<MarkMsgAsReadPayload, null> {
    readonly name = "mark_msg_as_read";
    readonly schema = markMsgAsReadSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: MarkReadDeps;

    constructor(deps: MarkReadDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: MarkMsgAsReadPayload): Promise<null> {
        if (payload.group_id !== undefined) {
            await this.deps.msgApi.markRead({
                chatType: ChatType.GROUP,
                peerUid: String(payload.group_id),
            });
            return null;
        }
        if (payload.user_id !== undefined) {
            const uidMap = await this.deps.uinToUid([String(payload.user_id)]);
            const uid = uidMap.get(String(payload.user_id));
            if (uid === undefined) {
                throw new Error(`用户 ${payload.user_id} 的 uid 解析失败`);
            }
            await this.deps.msgApi.markRead({ chatType: ChatType.C2C, peerUid: uid });
        }
        return null;
    }
}
