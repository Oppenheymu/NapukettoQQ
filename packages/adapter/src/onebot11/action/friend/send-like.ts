/**
 * send_like 动作：点赞（P2-14 接 kernel ProfileLikeApi.sendLike）
 */
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import { ob11ErrorCodeMap } from "../error-map.js";
import { resolveUid } from "../resolve-uid.js";

const sendLikeSchema = z.object({
    user_id: z.number(),
    times: z.number().optional(),
});

type SendLikePayload = z.infer<typeof sendLikeSchema>;

/** send_like 依赖（uinToUid 转 uid，OneBotApi 视图）。 */
export type SendLikeDeps = Pick<OneBotApi, "profileLikeApi" | "uinToUid">;

/** 点赞（P2-14 接 kernel ProfileLikeApi）。 */
export class SendLikeAction extends BaseAction<SendLikePayload, null> {
    readonly name = "send_like";
    readonly schema = sendLikeSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: SendLikeDeps;

    constructor(deps: SendLikeDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: SendLikePayload): Promise<null> {
        const uid = await resolveUid(String(payload.user_id), this.deps.uinToUid);
        await this.deps.profileLikeApi.sendLike(uid, payload.times ?? 1);
        return null;
    }
}
