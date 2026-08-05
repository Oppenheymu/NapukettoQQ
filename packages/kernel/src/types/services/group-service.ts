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

/** 踢人请求项（KickMemberV2Req.kickList 成员，说明书参考，字段值待探测校准）。 */
export interface KickMemberInfo {
    optFlag: number;
    optOperate: number;
    optMemberUid: string;
    optBytesMsg: string;
}

/** 踢人请求（set_group_kick 的 kickMemberV2 参数，说明书参考）。 */
export interface KickMemberV2Req {
    groupCode: string;
    kickFlag: number;
    kickList: KickMemberInfo[];
    kickListUids: string[];
    kickMsg: string;
}

/** @all 剩余次数（getGroupRemainAtTimes 返回）。 */
export interface GroupRemainAtTimes {
    canAtAll: boolean;
    remainAtAllCountForUin: number;
    remainAtAllCountForGroup: number;
    atTimesMsg: string;
    canNotAtAllMsg: string;
}

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
    /** 踢人（set_group_kick）。 */
    kickMemberV2(param: KickMemberV2Req): Promise<GeneralCallResult>;
    /** 成员禁言（set_group_ban；timeStamp=0 解除禁言）。 */
    setMemberShutUp(
        groupCode: string,
        memberTimes: Array<{ uid: string; timeStamp: number }>,
    ): Promise<GeneralCallResult>;
    /** 全员禁言（set_group_whole_ban）。 */
    setGroupShutUp(groupCode: string, shutUp: boolean): Promise<GeneralCallResult>;
    /** 设置管理员（set_group_admin；void 语义，乐观处理）。 */
    modifyMemberRole(groupCode: string, uid: string, role: NTGroupMemberRole): void;
    /** 设置群名片（set_group_card；void 语义）。 */
    modifyMemberCardName(groupCode: string, uid: string, cardName: string): void;
    /** 修改群名（set_group_name）。 */
    modifyGroupName(
        groupCode: string,
        groupName: string,
        isNormalMember: boolean,
    ): Promise<GeneralCallResult>;
    /** 退群（set_group_leave）。 */
    quitGroupV2(param: {
        groupCode: string;
        needDeleteLocalMsg: boolean;
    }): Promise<GeneralCallResult>;
    /** 设置精华消息（msgSeq/msgRandom 取自消息本体）。 */
    addGroupEssence(param: {
        groupCode: string;
        msgRandom: number;
        msgSeq: number;
    }): Promise<unknown>;
    /** 取消精华消息。 */
    removeGroupEssence(param: {
        groupCode: string;
        msgRandom: number;
        msgSeq: number;
    }): Promise<unknown>;
    /** @all 剩余次数（get_group_at_all_remain）。 */
    getGroupRemainAtTimes(groupCode: string): Promise<
        Omit<GeneralCallResult, "result"> & {
            errCode: number;
            atInfo: GroupRemainAtTimes;
        }
    >;
}
