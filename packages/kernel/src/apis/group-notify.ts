/**
 * GroupNotifyApi：群通知/禁言列表语义化 API（ADR-009 统一错误语义，P2-13）
 *
 * get_group_system_msg / set_group_add_request / get_group_shut_list 共用。
 * getSingleScreenNotifies / getGroupShutUpMemberList 的列表可能走 listener 回调，
 * 直接调用返回形状待探测校准：兼容 result 数组 / 字段 / 直接数组。
 */
import { kernelError } from "../infra/errors.js";
import type {
    GroupMember,
    GroupNotify,
    NodeIKernelGroupService,
    NTGroupRequestOperateTypes,
} from "../types/services/group-service.js";
import type { NodeIQQNTWrapperSession } from "../types/wrapper.js";
import { unwrap } from "./result.js";

/** 群通知 API：从 session 拿 group service，包装成语义化方法。 */
export class GroupNotifyApi {
    private readonly service: NodeIKernelGroupService;

    constructor(session: NodeIQQNTWrapperSession) {
        const service = session.getGroupService() as unknown as NodeIKernelGroupService | null;
        if (service === null || service === undefined) {
            throw kernelError("getGroupService() 返回空（session 未 init）", "INVALID_STATE");
        }
        this.service = service;
    }

    /** 单屏通知列表（get_group_system_msg / set_group_add_request 共用）。 */
    async getSingleScreenNotifies(doubt: boolean, count: number): Promise<GroupNotify[]> {
        const raw = await this.service.getSingleScreenNotifies(doubt, "", count);
        return extractNotifyList(raw.result);
    }

    /** 禁言成员列表（get_group_shut_list）。 */
    async getGroupShutUpMemberList(groupCode: string): Promise<GroupMember[]> {
        const raw = await this.service.getGroupShutUpMemberList(groupCode);
        if (raw.result !== 0) {
            unwrap("getGroupShutUpMemberList", raw.result, raw.errMsg);
        }
        return extractMemberList(raw.result);
    }

    /** 处理群请求（set_group_add_request 应答；approve=true 同意 / false 拒绝）。 */
    async handleGroupRequest(
        doubt: boolean,
        notify: GroupNotify,
        operateType: NTGroupRequestOperateTypes,
        reason: string,
    ): Promise<void> {
        const { group, seq, type } = notify;
        let groupCode = "";
        if (group !== undefined) {
            ({ groupCode } = group);
        }
        let postscript = reason;
        if (postscript === "") {
            postscript = " ";
        }
        await this.service.operateSysNotify(doubt, {
            operateType,
            targetMsg: {
                seq,
                type,
                groupCode,
                postscript,
            },
        });
    }
}

/** 从 getSingleScreenNotifies 返回提取通知数组（兼容 result 数组 / notifies 字段）。 */
function extractNotifyList(result: unknown): GroupNotify[] {
    if (Array.isArray(result)) {
        return result as GroupNotify[];
    }
    if (result !== null && typeof result === "object") {
        const obj = result as { notifies?: unknown; groupNotifies?: unknown };
        if (Array.isArray(obj.notifies)) {
            return obj.notifies as GroupNotify[];
        }
        if (Array.isArray(obj.groupNotifies)) {
            return obj.groupNotifies as GroupNotify[];
        }
    }
    return [];
}

/** 从 getGroupShutUpMemberList 返回提取成员数组（兼容 result 数组 / memberList 字段）。 */
function extractMemberList(result: unknown): GroupMember[] {
    if (Array.isArray(result)) {
        return result as unknown as GroupMember[];
    }
    if (result !== null && typeof result === "object") {
        const obj = result as { memberList?: unknown; list?: unknown };
        if (Array.isArray(obj.memberList)) {
            return obj.memberList as unknown as GroupMember[];
        }
        if (Array.isArray(obj.list)) {
            return obj.list as unknown as GroupMember[];
        }
    }
    return [];
}
