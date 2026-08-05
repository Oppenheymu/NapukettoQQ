/**
 * GroupApi：群语义化 API（ADR-009 统一错误语义）
 *
 * 内部解包原生返回：成功返回纯业务值，失败抛 KernelError。
 * 方法面（P2-4）：群列表 / 群详情 / 成员列表 / 成员详情 / uin↔uid。
 */
import { kernelError } from "../errors.js";
import type { NodeIKernelGroupService } from "../types/services/group-service.js";
import {
    type Group,
    type GroupDetailInfo,
    type GroupMember,
    NTGroupMemberRole,
} from "../types/services/group-service.js";
import type { NodeIQQNTWrapperSession } from "../types/wrapper.js";

/** 原生 result 解包（result 字段非 0 抛 KernelError）。 */
function unwrap(label: string, result: number, errMsg?: string): void {
    if (result === 0) {
        return;
    }
    throw kernelError(`${label} 失败: ${errMsg ?? "无错误详情"}`, "UNKNOWN");
}

/** 群 API：从 session 拿 group service，包装成语义化方法。 */
export class GroupApi {
    private readonly service: NodeIKernelGroupService;

    constructor(session: NodeIQQNTWrapperSession) {
        const service = session.getGroupService() as unknown as NodeIKernelGroupService | null;
        if (service === null || service === undefined) {
            throw kernelError("getGroupService() 返回空（session 未 init）", "INVALID_STATE");
        }
        this.service = service;
    }

    /** 群列表（force=true 强制刷新，默认缓存）。 */
    async getGroupList(force = false): Promise<Group[]> {
        const raw = await this.service.getGroupList(force);
        if (raw.result !== 0) {
            unwrap("getGroupList", raw.result, raw.errMsg);
        }
        // 返回形状待探测校准：优先兼容数组与 { groupList }
        const list = (raw as unknown as { groupList?: Group[] }).groupList;
        if (Array.isArray(list)) {
            return list;
        }
        return [];
    }

    /** 群详情（groupCode 为群号字符串）。
     * getGroupDetailInfo 返回的 result 字段可能是错误码（数字）或详情对象——
     * 两种形状都兼容，探测校准后再收紧。 */
    async getGroupInfo(groupCode: string): Promise<GroupDetailInfo> {
        const raw = await this.service.getGroupDetailInfo(groupCode, 0);
        const { result, errMsg } = raw as { result?: unknown; errMsg: string };
        if (typeof result === "number" && result !== 0) {
            unwrap("getGroupDetailInfo", result, errMsg);
        }
        if (result !== null && typeof result === "object") {
            return result as unknown as GroupDetailInfo;
        }
        return raw as unknown as GroupDetailInfo;
    }

    /** 群成员列表（forceFetch=true 强制拉取，默认缓存优先）。 */
    async getGroupMemberList(groupCode: string, forceFetch = false): Promise<GroupMember[]> {
        const raw = await this.service.getAllMemberList(groupCode, forceFetch);
        if (raw.errCode !== 0) {
            throw kernelError(`getAllMemberList 失败: ${raw.errMsg}`, "UNKNOWN");
        }
        return [...raw.result.infos.values()];
    }

    /** 群成员详情（uids 为空返回空数组）。 */
    async getGroupMemberInfo(groupCode: string, uids: string[]): Promise<GroupMember[]> {
        if (uids.length === 0) {
            return [];
        }
        const raw = await this.service.getMemberInfo(groupCode, uids, true);
        unwrap("getMemberInfo", raw.result, raw.errMsg);
        // 返回形状待探测校准：infos Map<uid, GroupMember>
        const { infos } = raw as unknown as { infos?: Map<string, GroupMember> };
        if (infos instanceof Map) {
            return [...infos.values()];
        }
        return [];
    }

    /** uin → uid（私聊发送等需要）。 */
    async uinToUid(uins: string[]): Promise<Map<string, string>> {
        if (uins.length === 0) {
            return new Map();
        }
        const raw = await this.service.getUidByUins(uins);
        if (raw.errCode !== 0) {
            throw kernelError(`getUidByUins 失败: ${raw.errMsg}`, "UNKNOWN");
        }
        return raw.uids;
    }

    /** uid → uin。 */
    async uidToUin(uids: string[]): Promise<Map<string, string>> {
        if (uids.length === 0) {
            return new Map();
        }
        const raw = await this.service.getUinByUids(uids);
        if (raw.errCode !== 0) {
            throw kernelError(`getUinByUids 失败: ${raw.errMsg}`, "UNKNOWN");
        }
        return raw.uins;
    }

    /** 群成员角色 → OB11 role 字符串。 */
    static roleToString(role: NTGroupMemberRole): "owner" | "admin" | "member" {
        if (role === NTGroupMemberRole.OWNER) {
            return "owner";
        }
        if (role === NTGroupMemberRole.ADMIN) {
            return "admin";
        }
        return "member";
    }
}
