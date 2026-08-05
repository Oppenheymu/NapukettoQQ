/**
 * get_group_add_request / get_group_ignored_notifies 动作（P2-15 接 kernel GroupNotifyApi）
 *
 * 与 set_group_add_request 呼应：flag=seq 用于应答。
 * - get_group_add_request：未处理申请列表（getSingleScreenNotifies(false)）
 * - get_group_ignored_notifies：可疑/忽略列表（getSingleScreenNotifies(true)）
 */
import type { GroupNotify, GroupNotifyApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getGroupAddRequestSchema = z.object({
    count: z.number().optional(),
});

type GetGroupAddRequestPayload = z.infer<typeof getGroupAddRequestSchema>;

/** 默认获取数量。 */
const DEFAULT_COUNT = 100;

/** 群请求项 OB11 结构。 */
export interface GroupAddRequestItem {
    flag: string;
    group_id: number;
    group_name: string;
    user_id: number;
    user_nick: string;
    type: number;
    checked: boolean;
    postscript: string;
}

/** 获取未处理群申请（P2-15）。 */
export class GetGroupAddRequestAction extends BaseAction<
    GetGroupAddRequestPayload,
    GroupAddRequestItem[]
> {
    readonly name = "get_group_add_request";
    readonly schema = getGroupAddRequestSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly groupNotifyApi: GroupNotifyApi;

    constructor(groupNotifyApi: GroupNotifyApi) {
        super();
        this.groupNotifyApi = groupNotifyApi;
    }

    protected async _handle(payload: GetGroupAddRequestPayload): Promise<GroupAddRequestItem[]> {
        const list = await this.groupNotifyApi.getSingleScreenNotifies(
            false,
            payload.count ?? DEFAULT_COUNT,
        );
        return list.map(toGroupAddRequestItem);
    }
}

/** 获取被忽略群申请（P2-15）。 */
export class GetGroupIgnoredNotifiesAction extends BaseAction<
    GetGroupAddRequestPayload,
    GroupAddRequestItem[]
> {
    readonly name = "get_group_ignored_notifies";
    readonly schema = getGroupAddRequestSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly groupNotifyApi: GroupNotifyApi;

    constructor(groupNotifyApi: GroupNotifyApi) {
        super();
        this.groupNotifyApi = groupNotifyApi;
    }

    protected async _handle(payload: GetGroupAddRequestPayload): Promise<GroupAddRequestItem[]> {
        const list = await this.groupNotifyApi.getSingleScreenNotifies(
            true,
            payload.count ?? DEFAULT_COUNT,
        );
        return list.map(toGroupAddRequestItem);
    }
}

/** GroupNotify → OB11 群请求项（纯函数）。 */
function toGroupAddRequestItem(notify: GroupNotify): GroupAddRequestItem {
    const { seq, type, status, postscript, user1, group } = notify;
    let groupCode = 0;
    let groupName = "";
    if (group !== undefined) {
        const { groupCode: code, groupName: name } = group;
        groupCode = Number(code);
        groupName = name;
    }
    let userId = 0;
    let userNick = "";
    if (user1 !== undefined) {
        const { uid, nickName } = user1;
        userId = Number(uid);
        userNick = nickName;
    }
    return {
        flag: seq,
        group_id: groupCode,
        group_name: groupName,
        user_id: userId,
        user_nick: userNick,
        type,
        checked: status !== 1,
        postscript: postscript ?? "",
    };
}
