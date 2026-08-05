/**
 * GroupApi：群语义化 API（ADR-009 统一错误语义）
 *
 * 内部解包原生返回：成功返回纯业务值，失败抛 KernelError。
 * 方法面（P2-4 + P2-10）：群列表 / 群详情 / 成员列表 / 成员详情 / uin↔uid +
 * 群管操作（踢人 / 禁言 / 管理员 / 名片 / 群名 / 退群 / 精华消息 / @all 剩余）。
 */
import { kernelError } from "../errors.js";
import { ChatType } from "../types/entities.js";
import type { NodeIKernelGroupService } from "../types/services/group-service.js";
import {
    type Group,
    type GroupDetailInfo,
    type GroupMember,
    type KickMemberV2Req,
    NTGroupMemberRole,
} from "../types/services/group-service.js";
import type { NodeIKernelMsgService } from "../types/services/msg-service.js";
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
    /** 精华消息需要 msg service（按 msgId 拉消息取 msgSeq/msgRandom）。 */
    private readonly msgService: NodeIKernelMsgService;

    constructor(session: NodeIQQNTWrapperSession) {
        const service = session.getGroupService() as unknown as NodeIKernelGroupService | null;
        if (service === null || service === undefined) {
            throw kernelError("getGroupService() 返回空（session 未 init）", "INVALID_STATE");
        }
        this.service = service;
        const msgService = session.getMsgService() as unknown as NodeIKernelMsgService | null;
        if (msgService === null || msgService === undefined) {
            throw kernelError("getMsgService() 返回空（session 未 init）", "INVALID_STATE");
        }
        this.msgService = msgService;
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

    /**
     * 踢人（set_group_kick）。memberUids 为成员 uid；refuseForever=true 拉黑拒绝再次入群。
     * kickMemberV2 的 kickFlag/kickList 字段值待探测校准（TODO P3 联调）。
     */
    async kickMember(
        groupCode: string,
        memberUids: string[],
        refuseForever: boolean,
        reason = "",
    ): Promise<void> {
        if (memberUids.length === 0) {
            throw kernelError("kickMember 需要至少一个成员 uid", "INVALID_PARAM");
        }
        // refuseForever=true 拒绝再次入群（optFlag 字段值待探测校准）
        let optFlag = 1;
        if (refuseForever) {
            optFlag = 0;
        }
        const req: KickMemberV2Req = {
            groupCode,
            kickFlag: 0,
            kickList: memberUids.map((uid) => ({
                optFlag,
                optOperate: 0,
                optMemberUid: uid,
                optBytesMsg: "",
            })),
            kickListUids: memberUids,
            kickMsg: reason,
        };
        const raw = await this.service.kickMemberV2(req);
        unwrap("kickMemberV2", raw.result, raw.errMsg);
    }

    /** 成员禁言（duration 秒，0 解除禁言）。 */
    async setMemberShutUp(
        groupCode: string,
        members: Array<{ uid: string; duration: number }>,
    ): Promise<void> {
        if (members.length === 0) {
            throw kernelError("setMemberShutUp 需要至少一个成员", "INVALID_PARAM");
        }
        const raw = await this.service.setMemberShutUp(
            groupCode,
            members.map((m) => ({ uid: m.uid, timeStamp: m.duration })),
        );
        unwrap("setMemberShutUp", raw.result, raw.errMsg);
    }

    /** 全员禁言（enable=true 开启全群禁言）。 */
    async setGroupShutUp(groupCode: string, enable: boolean): Promise<void> {
        const raw = await this.service.setGroupShutUp(groupCode, enable);
        unwrap("setGroupShutUp", raw.result, raw.errMsg);
    }

    /** 设置管理员（role=ADMIN 设管理，MEMBER 取消；void 语义乐观处理）。 */
    setMemberRole(groupCode: string, uid: string, role: NTGroupMemberRole): void {
        this.service.modifyMemberRole(groupCode, uid, role);
    }

    /** 设置群名片（void 语义乐观处理）。 */
    setMemberCardName(groupCode: string, uid: string, cardName: string): void {
        this.service.modifyMemberCardName(groupCode, uid, cardName);
    }

    /** 修改群名。 */
    async modifyGroupName(groupCode: string, groupName: string): Promise<void> {
        const raw = await this.service.modifyGroupName(groupCode, groupName, false);
        unwrap("modifyGroupName", raw.result, raw.errMsg);
    }

    /** 退群（needDeleteLocalMsg=is_dismiss：是否解散群，仅群主）。 */
    async quitGroup(groupCode: string, needDeleteLocalMsg = false): Promise<void> {
        const raw = await this.service.quitGroupV2({ groupCode, needDeleteLocalMsg });
        unwrap("quitGroupV2", raw.result, raw.errMsg);
    }

    /** 设置精华消息（msgId 经 msgService 取 msgSeq/msgRandom）。 */
    async addGroupEssence(groupCode: string, msgId: string): Promise<void> {
        await this.setEssence(groupCode, msgId, true);
    }

    /** 取消精华消息。 */
    async removeGroupEssence(groupCode: string, msgId: string): Promise<void> {
        await this.setEssence(groupCode, msgId, false);
    }

    /** 精华消息公共流程：按 msgId 拉消息 → add/removeGroupEssence。 */
    private async setEssence(groupCode: string, msgId: string, add: boolean): Promise<void> {
        const peer = { chatType: ChatType.GROUP, peerUid: groupCode };
        const raw = await this.msgService.getMsgsByMsgId(peer, [msgId]);
        unwrap("getMsgsByMsgId", raw.result, raw.errMsg);
        const msg = raw.msgList?.[0];
        if (msg === undefined) {
            throw kernelError(`消息 ${msgId} 不存在`, "NOT_FOUND");
        }
        const param = {
            groupCode,
            msgRandom: Number(msg.msgRandom ?? 0),
            msgSeq: Number(msg.msgSeq),
        };
        let label = "removeGroupEssence";
        let res: { result?: unknown; errMsg?: unknown } | undefined;
        if (add) {
            label = "addGroupEssence";
            res = (await this.service.addGroupEssence(param)) as
                | { result?: unknown; errMsg?: unknown }
                | undefined;
        } else {
            res = (await this.service.removeGroupEssence(param)) as
                | { result?: unknown; errMsg?: unknown }
                | undefined;
        }
        // 宽松校验：返回对象带 result 数字非 0 视为失败（形状待探测校准）
        if (
            res !== undefined &&
            res !== null &&
            typeof res.result === "number" &&
            res.result !== 0
        ) {
            throw kernelError(`${label} 失败: ${String(res.errMsg ?? "")}`, "UNKNOWN");
        }
    }

    /** @all 剩余次数（get_group_at_all_remain）。 */
    async getGroupRemainAtTimes(groupCode: string): Promise<{
        canAtAll: boolean;
        remainAtAllCountForUin: number;
        remainAtAllCountForGroup: number;
    }> {
        const raw = await this.service.getGroupRemainAtTimes(groupCode);
        if (raw.errCode !== 0) {
            throw kernelError(`getGroupRemainAtTimes 失败: ${raw.errMsg}`, "UNKNOWN");
        }
        return {
            canAtAll: raw.atInfo.canAtAll,
            remainAtAllCountForUin: raw.atInfo.remainAtAllCountForUin,
            remainAtAllCountForGroup: raw.atInfo.remainAtAllCountForGroup,
        };
    }
}
