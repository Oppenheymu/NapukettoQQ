/**
 * get_group_list 动作：获取群列表（P2-4 接 kernel GroupApi + GroupCache）
 *
 * ⚠️ 实测校准（2026-08-08 端到端联调）：原生 getGroupList 返回值无数据
 * （仅 { result, errMsg }），列表经 onGroupListUpdate 事件推送 → GroupCache
 * 维护——列表一律从缓存读，no_cache=true 仅触发原生刷新。
 */

import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import { toOb11GroupInfo } from "../../helper/translate.js";
import type { GroupInfo } from "../../types/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getGroupListSchema = z.object({
    /** 是否忽略缓存（go-cqhttp 扩展）。 */
    no_cache: z.boolean().optional(),
});

type GetGroupListPayload = z.infer<typeof getGroupListSchema>;

/** 获取群列表（P2-4 接 kernel apis/group；群列表数据经事件推送，从 GroupCache 读）。 */
export class GetGroupListAction extends BaseAction<GetGroupListPayload, GroupInfo[]> {
    readonly name = "get_group_list";
    readonly schema = getGroupListSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: Pick<OneBotApi, "groupApi" | "groupCache">;

    constructor(deps: Pick<OneBotApi, "groupApi" | "groupCache">) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: GetGroupListPayload): Promise<GroupInfo[]> {
        // 实测校准（2026-08-08）：原生 getGroupList 返回值无数据，列表经
        // onGroupListUpdate 事件推送 → GroupCache 维护；缓存为空时
        // listGroupsRefreshed 主动触发刷新并等待回填。
        // no_cache=true 兼容：始终触发刷新（语义等价缓存必空场景）。
        const groups =
            this.deps.groupCache === undefined
                ? await this.deps.groupApi.getGroupList(true)
                : payload.no_cache === true
                  ? await this.deps.groupCache.listGroupsRefreshed()
                  : this.deps.groupCache.listGroups();
        return groups.map(toOb11GroupInfo);
    }
}
