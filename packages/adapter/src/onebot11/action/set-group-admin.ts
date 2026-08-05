/**
 * set_group_admin 动作：设置群管理员（P2-10 接 kernel GroupApi.setMemberRole）
 *
 * enable=true 设为管理员，false 取消；user_id → uinToUid。
 */

import type { GroupApi } from "@napuketto/kernel";
import { NTGroupMemberRole } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const setGroupAdminSchema = z.object({
    group_id: z.number(),
    user_id: z.number(),
    /** 是否设为管理员。 */
    enable: z.boolean().default(true),
});

type SetGroupAdminPayload = z.infer<typeof setGroupAdminSchema>;

/** 设置群管理员（P2-10 接 kernel setMemberRole）。 */
export class SetGroupAdminAction extends BaseAction<SetGroupAdminPayload, null> {
    readonly name = "set_group_admin";
    readonly schema = setGroupAdminSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly groupApi: GroupApi;

    constructor(groupApi: GroupApi) {
        super();
        this.groupApi = groupApi;
    }

    protected async _handle(payload: SetGroupAdminPayload): Promise<null> {
        const uidMap = await this.groupApi.uinToUid([String(payload.user_id)]);
        const uid = uidMap.get(String(payload.user_id));
        if (uid === undefined) {
            throw new Error(`用户 ${payload.user_id} 的 uid 解析失败`);
        }
        let role: NTGroupMemberRole = NTGroupMemberRole.MEMBER;
        if (payload.enable) {
            role = NTGroupMemberRole.ADMIN;
        }
        this.groupApi.setMemberRole(String(payload.group_id), uid, role);
        return null;
    }
}
