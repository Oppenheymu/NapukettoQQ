/**
 * set_group_card 动作：设置群名片（P2-10 接 kernel GroupApi.setMemberCardName）
 */

import type { GroupApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";
import { resolveUid } from "../resolve-uid.js";

const setGroupCardSchema = z.object({
    group_id: z.number(),
    user_id: z.number(),
    /** 群名片（空串清除）。 */
    card: z.string().optional().default(""),
});

type SetGroupCardPayload = z.infer<typeof setGroupCardSchema>;

/** 设置群名片（P2-10 接 kernel setMemberCardName）。 */
export class SetGroupCardAction extends BaseAction<SetGroupCardPayload, null> {
    readonly name = "set_group_card";
    readonly schema = setGroupCardSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly groupApi: GroupApi;

    constructor(groupApi: GroupApi) {
        super();
        this.groupApi = groupApi;
    }

    protected async _handle(payload: SetGroupCardPayload): Promise<null> {
        const uid = await resolveUid(String(payload.user_id), (uins) =>
            this.groupApi.uinToUid(uins),
        );
        this.groupApi.setMemberCardName(String(payload.group_id), uid, payload.card);
        return null;
    }
}
