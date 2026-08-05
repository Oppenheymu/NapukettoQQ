/**
 * get_group_shut_list 动作：获取群禁言列表（P2-13 接 kernel GroupNotifyApi）
 *
 * getGroupShutUpMemberList → [{ user_id, nickname, shut_up_time }]（uin 经 uidToUin）。
 */

import type { GroupNotifyApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const getGroupShutListSchema = z.object({
    group_id: z.number(),
});

type GetGroupShutListPayload = z.infer<typeof getGroupShutListSchema>;

/** 禁言成员 OB11 结构。 */
export interface ShutListMember {
    user_id: number;
    nickname: string;
    shut_up_time: number;
}

/** 获取群禁言列表（P2-13 接 kernel GroupNotifyApi）。 */
export class GetGroupShutListAction extends BaseAction<GetGroupShutListPayload, ShutListMember[]> {
    readonly name = "get_group_shut_list";
    readonly schema = getGroupShutListSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: {
        groupNotifyApi: GroupNotifyApi;
        uidToUin: (uids: string[]) => Promise<Map<string, string>>;
    };

    constructor(deps: {
        groupNotifyApi: GroupNotifyApi;
        uidToUin: (uids: string[]) => Promise<Map<string, string>>;
    }) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: GetGroupShutListPayload): Promise<ShutListMember[]> {
        const members = await this.deps.groupNotifyApi.getGroupShutUpMemberList(
            String(payload.group_id),
        );
        const uids = members.map((m) => m.uid);
        let uinMap = new Map<string, string>();
        if (uids.length > 0) {
            uinMap = await this.deps.uidToUin(uids);
        }
        const out: ShutListMember[] = [];
        for (const member of members) {
            out.push({
                user_id: Number(uinMap.get(member.uid) ?? member.uin ?? member.uid),
                nickname: member.nick,
                shut_up_time: member.shutUpTime,
            });
        }
        return out;
    }
}
