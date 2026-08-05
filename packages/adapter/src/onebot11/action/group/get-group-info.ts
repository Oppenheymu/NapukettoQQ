/**
 * get_group_info 动作：获取群信息（P2-4 接 kernel GroupApi；P2-17 读缓存）
 */

import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import { toOb11GroupInfoDetail } from "../../helper/translate.js";
import type { GroupInfo } from "../../types/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getGroupInfoSchema = z.object({
    group_id: z.number(),
    /** 是否忽略缓存（go-cqhttp 扩展）。 */
    no_cache: z.boolean().optional(),
});

type GetGroupInfoPayload = z.infer<typeof getGroupInfoSchema>;

/** 获取群信息（P2-4 接 kernel apis/group；P2-17 优先读 GroupCache）。 */
export class GetGroupInfoAction extends BaseAction<GetGroupInfoPayload, GroupInfo> {
    readonly name = "get_group_info";
    readonly schema = getGroupInfoSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: Pick<OneBotApi, "groupApi" | "groupCache">;

    constructor(deps: Pick<OneBotApi, "groupApi" | "groupCache">) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: GetGroupInfoPayload): Promise<GroupInfo> {
        const groupCode = String(payload.group_id);
        if (payload.no_cache !== true && this.deps.groupCache !== undefined) {
            const detail = await this.deps.groupCache.getGroupDetail(groupCode);
            return toOb11GroupInfoDetail(detail);
        }
        const detail = await this.deps.groupApi.getGroupInfo(groupCode);
        return toOb11GroupInfoDetail(detail);
    }
}
