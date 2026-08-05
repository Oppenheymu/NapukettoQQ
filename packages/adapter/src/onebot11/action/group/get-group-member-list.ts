/**
 * get_group_member_list 动作：获取群成员列表（P2-4 接 kernel GroupApi；P2-17 读缓存）
 */

import type { GroupMember } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import { toOb11GroupMemberInfo } from "../../helper/translate.js";
import type { GroupMemberInfo } from "../../types/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getGroupMemberListSchema = z.object({
    group_id: z.number(),
    /** 是否忽略缓存（go-cqhttp 扩展）。 */
    no_cache: z.boolean().optional(),
});

type GetGroupMemberListPayload = z.infer<typeof getGroupMemberListSchema>;

/** 获取群成员列表（P2-4 接 kernel apis/group；P2-17 优先读 GroupCache）。 */
export class GetGroupMemberListAction extends BaseAction<
    GetGroupMemberListPayload,
    GroupMemberInfo[]
> {
    readonly name = "get_group_member_list";
    readonly schema = getGroupMemberListSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: Pick<OneBotApi, "groupApi" | "groupCache">;

    constructor(deps: Pick<OneBotApi, "groupApi" | "groupCache">) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: GetGroupMemberListPayload): Promise<GroupMemberInfo[]> {
        const groupCode = String(payload.group_id);
        const noCache = payload.no_cache === true;
        let members: GroupMember[];
        if (noCache || this.deps.groupCache === undefined) {
            members = await this.deps.groupApi.getGroupMemberList(groupCode, noCache);
        } else {
            members = await this.deps.groupCache.getMembers(groupCode);
        }
        const uinMap = await this.deps.groupApi.uidToUin(members.map((m) => m.uid));
        return members.map((m) => toOb11GroupMemberInfo(groupCode, m, uinMap));
    }
}
