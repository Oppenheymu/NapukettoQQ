/**
 * set_group_add_request 动作：处理加群请求（P2-13 接 kernel GroupNotifyApi）
 *
 * flag=seq（群请求事件上报的 flag）→ getSingleScreenNotifies(doubt, count)
 * 匹配 → handleGroupRequest（approve=true→同意 / false→拒绝，reason 默认空格）。
 */

import type { GroupNotify, GroupNotifyApi } from "@napuketto/kernel";
import { NTGroupRequestOperateTypes } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const setGroupAddRequestSchema = z.object({
    flag: z.string(),
    approve: z.boolean().optional(),
    reason: z.string().optional(),
    count: z.number().optional(),
});

type SetGroupAddRequestPayload = z.infer<typeof setGroupAddRequestSchema>;

/** 默认搜索通知数量。 */
const DEFAULT_COUNT = 100;

/** 处理加群请求（P2-13 接 kernel GroupNotifyApi）。 */
export class SetGroupAddRequestAction extends BaseAction<SetGroupAddRequestPayload, null> {
    readonly name = "set_group_add_request";
    readonly schema = setGroupAddRequestSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly groupNotifyApi: GroupNotifyApi;

    constructor(groupNotifyApi: GroupNotifyApi) {
        super();
        this.groupNotifyApi = groupNotifyApi;
    }

    protected async _handle(payload: SetGroupAddRequestPayload): Promise<null> {
        const count = payload.count ?? DEFAULT_COUNT;
        const notify = await this.findNotify(payload.flag, count);
        if (notify === null) {
            throw new Error("未找到对应的群请求（flag 无效或已过期）");
        }
        let operateType: NTGroupRequestOperateTypes = NTGroupRequestOperateTypes.KREFUSE;
        if (payload.approve !== false) {
            operateType = NTGroupRequestOperateTypes.KAGREE;
        }
        await this.groupNotifyApi.handleGroupRequest(
            false,
            notify,
            operateType,
            payload.reason ?? " ",
        );
        return null;
    }

    /** 按 seq 匹配通知（先非可疑，后可疑）。 */
    private async findNotify(flag: string, count: number): Promise<GroupNotify | null> {
        const normal = await this.groupNotifyApi.getSingleScreenNotifies(false, count);
        const hit = normal.find((item) => item.seq === flag);
        if (hit !== undefined) {
            return hit;
        }
        const doubt = await this.groupNotifyApi.getSingleScreenNotifies(true, count);
        return doubt.find((item) => item.seq === flag) ?? null;
    }
}
