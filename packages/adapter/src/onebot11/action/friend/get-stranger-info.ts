/**
 * get_stranger_info 动作：获取陌生人信息（P2-15 接 kernel ProfileApi.getStrangerInfo）
 */
import type { ProfileApi, StrangerInfo } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getStrangerInfoSchema = z.object({
    user_id: z.number(),
    no_cache: z.boolean().optional(),
});

type GetStrangerInfoPayload = z.infer<typeof getStrangerInfoSchema>;

/** 获取陌生人信息（P2-15 接 kernel ProfileApi）。 */
export class GetStrangerInfoAction extends BaseAction<GetStrangerInfoPayload, StrangerInfo> {
    readonly name = "get_stranger_info";
    readonly schema = getStrangerInfoSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly profileApi: ProfileApi;

    constructor(profileApi: ProfileApi) {
        super();
        this.profileApi = profileApi;
    }

    protected async _handle(payload: GetStrangerInfoPayload): Promise<StrangerInfo> {
        const info = await this.profileApi.getStrangerInfo(String(payload.user_id));
        return {
            ...info,
            user_id: payload.user_id,
        };
    }
}
