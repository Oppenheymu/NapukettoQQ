/**
 * NodeIKernelGroupService：群服务接口面（自研描述，非移植）
 *
 * 依据：getGroupService() 运行时反射 + NapCat 公开类型作「说明书」理解 QQ wrapper
 * 契约（接口签名是外部系统的事实，自研描述其形状，零复制实现）。
 * 只收录 apis/group 当前需要的方法；其余按需探测后补齐。
 */
import type { GeneralCallResult } from "./msg-service.js";

/** 群成员角色（QQ wrapper 契约）。 */
export const NTGroupMemberRole = {
    UNSPECIFIED: 0,
    STRANGER: 1,
    MEMBER: 2,
    ADMIN: 3,
    OWNER: 4,
} as const;
export type NTGroupMemberRole = (typeof NTGroupMemberRole)[keyof typeof NTGroupMemberRole];

/** 群列表项（Group 实体，说明书参考）。 */
export interface Group {
    groupCode: string;
    groupName: string;
    memberCount: number;
    maxMember: number;
    remarkName?: string;
    groupOwnerId?: { memberUin: string; memberUid: string };
    memberRole?: number;
    isTop?: boolean;
    [key: string]: unknown;
}

/** 群详情（getGroupDetailInfo 返回，说明书参考）。 */
export interface GroupDetailInfo {
    groupCode: string;
    groupUin: string;
    ownerUin: string;
    ownerUid?: string;
    groupName: string;
    memberNum: number;
    maxMemberNum: number;
    remarkName?: string;
    isTop?: boolean;
    groupCreateTime?: number;
    [key: string]: unknown;
}

/** 群成员（getAllMemberList result.infos 的 value，说明书参考）。 */
export interface GroupMember {
    uid: string;
    uin: string;
    nick: string;
    cardName: string;
    remark: string;
    role: NTGroupMemberRole;
    shutUpTime: number; // 禁言秒数
    joinTime: string;
    lastSpeakTime: string;
    memberSpecialTitle?: string;
    sex?: number;
    age?: number;
    isRobot?: boolean;
    [key: string]: unknown;
}

/** 群服务：apis/group 用到的核心方法面。 */
export interface NodeIKernelGroupService {
    addKernelGroupListener(listener: unknown): number;
    removeKernelGroupListener(listenerId: number): void;
    getGroupList(force: boolean): Promise<GeneralCallResult>;
    getGroupDetailInfo(groupCode: string, groupInfoSource: number): Promise<GeneralCallResult>;
    getAllMemberList(
        groupCode: string,
        forceFetch: boolean,
    ): Promise<{
        errCode: number;
        errMsg: string;
        result: {
            ids: Array<{ uid: string; index: number }>;
            infos: Map<string, GroupMember>;
            finish: boolean;
        };
    }>;
    getMemberInfo(
        groupCode: string,
        uids: string[],
        forceFetch: boolean,
    ): Promise<GeneralCallResult>;
    /** uin → uid（私聊发送等需要，说明书参考）。 */
    getUidByUins(
        uins: string[],
    ): Promise<{ errCode: number; errMsg: string; uids: Map<string, string> }>;
    /** uid → uin。 */
    getUinByUids(
        uids: string[],
    ): Promise<{ errCode: number; errMsg: string; uins: Map<string, string> }>;
}
