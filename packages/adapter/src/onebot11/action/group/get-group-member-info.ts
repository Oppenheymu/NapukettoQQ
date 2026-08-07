/**
 * get_group_member_info 动作：获取群成员信息（P2-4 接 kernel GroupApi；P2-17 读缓存）
 */

import { type GroupMember, kernelError } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import { toOb11GroupMemberInfo } from "../../helper/translate.js";
import type { GroupMemberInfo } from "../../types/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getGroupMemberInfoSchema = z.object({
    group_id: z.number(),
    user_id: z.number(),
    /** 是否忽略缓存（go-cqhttp 扩展）。 */
    no_cache: z.boolean().optional(),
});

type GetGroupMemberInfoPayload = z.infer<typeof getGroupMemberInfoSchema>;

/** 获取群成员信息（P2-4 接 kernel apis/group；P2-17 优先读 GroupCache）。 */
export class GetGroupMemberInfoAction extends BaseAction<
    GetGroupMemberInfoPayload,
    GroupMemberInfo
> {
    readonly name = "get_group_member_info";
    readonly schema = getGroupMemberInfoSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: Pick<OneBotApi, "groupApi" | "groupCache">;

    constructor(deps: Pick<OneBotApi, "groupApi" | "groupCache">) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: GetGroupMemberInfoPayload): Promise<GroupMemberInfo> {
        const groupCode = String(payload.group_id);
        // user_id 是 uin：先 uin→uid，再查成员
        const uidMap = await this.deps.groupApi.uinToUid([String(payload.user_id)]);
        const uid = uidMap.get(String(payload.user_id));
        if (uid === undefined) {
            throw kernelError(`成员 ${payload.user_id} 不在群 ${payload.group_id}`, "NOT_FOUND");
        }
        const member = await this.resolveMember(groupCode, uid, payload.no_cache === true);
        if (member === undefined) {
            throw kernelError(`成员 ${payload.user_id} 不在群 ${payload.group_id}`, "NOT_FOUND");
        }
        const uinMap = await this.deps.groupApi.uidToUin([uid]);
        return toOb11GroupMemberInfo(groupCode, member, uinMap);
    }

    /** 读缓存（缺省）或直查 api（no_cache=true / 未装配缓存）。 */
    private async resolveMember(
        groupCode: string,
        uid: string,
        noCache: boolean,
    ): Promise<GroupMember | undefined> {
        if (noCache || this.deps.groupCache === undefined) {
            const members = await this.deps.groupApi.getGroupMemberInfo(groupCode, [uid]);
            const [member] = members;
            return member;
        }
        return await this.deps.groupCache.getMember(groupCode, uid);
    }
}
