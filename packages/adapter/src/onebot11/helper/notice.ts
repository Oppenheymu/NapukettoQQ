/**
 * OB11 notice 事件翻译（P2-7，2026-08-05；2026-09-08 T4 补全）
 *
 * NT QQ 中群成员变动/撤回等系统事件通过**消息的灰色提示元素（grayTip）**广播。
 * 本模块把 RawMessage 里的 grayTip 翻译为 OB11 notice 事件（纯函数，ADR-008）。
 *
 * 支持：
 *  - group_recall（群撤回，grayTip.subElementType=REVOKE + chatType=GROUP）
 *  - friend_recall（好友撤回，REVOKE + chatType=C2C，2026-09-08）
 *  - group_increase / group_decrease（群成员变动，subElementType=GROUP + TipGroupElement.type）
 *  - group_admin（管理员变更，TipGroupElement.type=BLOCK/UNBLOCK 的 role 语义）
 *  - group_ban（禁言，TipGroupElement.type=SHUT_UP）
 *  - notify.poke（戳一戳，aioOpGrayTipElement；⚠️ 待真实 poke 事件验证，2026-09-08）
 *
 * 未知/未翻译的 grayTip 子类型（JSON/BUDDY/ESSENCE/GROUP_NOTIFY 等）打 raw JSON
 * 日志（ctx.logger 可选）——为后续真实事件校准积累数据。
 *
 * user_id/operator_id 都是 uin：接收 uidToUin Map（调用方批量转换后传入，保持纯函数）。
 */
import {
    ChatType,
    type GrayTipElement,
    GrayTipSubType,
    type RawMessage,
    type TipGroupElement,
    TipGroupElementType,
} from "@napuketto/kernel";

export { collectGrayTipUids } from "../../core/gray-tip.js";

import type {
    OB11Event,
    OB11FriendRecallNoticeEvent,
    OB11GroupAdminNoticeEvent,
    OB11GroupBanNoticeEvent,
    OB11GroupDecreaseNoticeEvent,
    OB11GroupIncreaseNoticeEvent,
    OB11GroupRecallNoticeEvent,
    OB11NotifyNoticeEvent,
} from "../event/index.js";

/** 毫秒 → 秒（Unix 时间戳）。 */
const MS_TO_SEC = 1000;

/** grayTip 翻译上下文（uid→uin 映射，调用方批量转换）。 */
export interface NoticeTranslateContext {
    selfUin: string;
    uidToUin: Map<string, string>;
    /** 校准日志（可选：未知 grayTip 子类型/poke raw JSON；缺省静默）。 */
    logger?: { warn(obj: unknown, msg?: string): void };
}

/** 检查消息是否含可翻译的 grayTip 元素。 */
export function hasGrayTip(msg: RawMessage): boolean {
    return msg.elements.some((el) => el.grayTipElement !== undefined);
}

/** uid → uin（上下文映射缺省退化为 uid）。 */
function toUin(uid: string, ctx: NoticeTranslateContext): number {
    const uin = ctx.uidToUin.get(uid);
    return Number(uin ?? uid);
}

/** 基础字段（time/self_id/post_type）。 */
function base(
    msg: RawMessage,
    ctx: NoticeTranslateContext,
): {
    time: number;
    self_id: number;
    post_type: "notice";
    group_id: number;
} {
    return {
        time: Math.floor(Number(msg.msgTime) / MS_TO_SEC),
        self_id: Number(ctx.selfUin),
        post_type: "notice",
        group_id: Number(msg.peerUid),
    };
}

/** 撤回事件（chatType 分流：GROUP→group_recall / C2C→friend_recall，2026-09-08）。 */
function toRecall(
    msg: RawMessage,
    g: GrayTipElement,
    ctx: NoticeTranslateContext,
): OB11GroupRecallNoticeEvent | OB11FriendRecallNoticeEvent | null {
    if (g?.revokeElement === undefined) {
        return null;
    }
    const revoke = g.revokeElement;
    if (msg.chatType === ChatType.C2C) {
        // 好友撤回：user_id = 撤回者，message_id = msgSeq
        return {
            time: Math.floor(Number(msg.msgTime) / MS_TO_SEC),
            self_id: Number(ctx.selfUin),
            post_type: "notice",
            notice_type: "friend_recall",
            user_id: toUin(revoke.operatorUid, ctx),
            message_id: Number(msg.msgSeq),
        };
    }
    return {
        ...base(msg, ctx),
        notice_type: "group_recall",
        user_id: toUin(revoke.operatorUid, ctx),
        operator_id: toUin(revoke.operatorUid, ctx),
        message_id: Number(msg.msgSeq),
    };
}

/**
 * 戳一戳（notify.poke，aioOpGrayTipElement，2026-09-08）。
 *
 * ⚠️ 待真实 poke 事件验证：aioOp 载荷的完整字段形状未经实测（实体类型仅有
 * operateType/peerUid 两个已证字段）。当前口径：user_id = 消息发送者，
 * target_id = aioOp.peerUid（C2C 即对端；群内为目标 uid 的假设待校准），
 * group_id = 群号（C2C 为 0）。poke 路径始终打 raw 日志积累校准数据。
 */
function toPoke(
    msg: RawMessage,
    g: GrayTipElement,
    ctx: NoticeTranslateContext,
): OB11NotifyNoticeEvent {
    const aioOp = g?.aioOpGrayTipElement;
    ctx.logger?.warn(
        { raw: JSON.stringify(g)?.slice(0, 2000) },
        "ob11: poke grayTip raw（待真实事件校准）",
    );
    const isGroup = msg.chatType === ChatType.GROUP;
    return {
        time: Math.floor(Number(msg.msgTime) / MS_TO_SEC),
        self_id: Number(ctx.selfUin),
        post_type: "notice",
        notice_type: "notify",
        sub_type: "poke",
        group_id: isGroup ? Number(msg.peerUid) : 0,
        user_id: toUin(msg.senderUid, ctx),
        target_id: toUin(aioOp?.peerUid ?? "", ctx),
    };
}

/** 群成员变动（group_increase / group_decrease / group_admin / group_ban）。 */
function toGroupChange(
    msg: RawMessage,
    g: GrayTipElement,
    ctx: NoticeTranslateContext,
):
    | OB11GroupIncreaseNoticeEvent
    | OB11GroupDecreaseNoticeEvent
    | OB11GroupAdminNoticeEvent
    | OB11GroupBanNoticeEvent
    | null {
    const grp = g?.groupElement;
    if (grp === undefined || grp.type === undefined) {
        return null;
    }
    const common = {
        time: Math.floor(Number(msg.msgTime) / MS_TO_SEC),
        selfId: Number(ctx.selfUin),
        groupId: Number(msg.peerUid),
        memberUid: grp.memberUid ?? "",
        adminUid: grp.adminUid ?? "",
    };
    switch (grp.type) {
        case TipGroupElementType.MEMBER_ADD:
            return toMemberAdd(common, ctx);
        case TipGroupElementType.QUIT:
            return toQuit(common, ctx);
        case TipGroupElementType.BLOCK:
        case TipGroupElementType.UNBLOCK:
            return toAdminChange(common, grp, ctx);
        case TipGroupElementType.SHUT_UP:
            return toBan(common, grp, ctx);
        default:
            return null;
    }
}

/** 群成员变动公共字段。 */
interface GroupChangeCommon {
    time: number;
    selfId: number;
    groupId: number;
    memberUid: string;
    adminUid: string;
}

/** 群成员增加（approve=管理员操作 / invite=普通邀请）。 */
function toMemberAdd(
    common: GroupChangeCommon,
    ctx: NoticeTranslateContext,
): OB11GroupIncreaseNoticeEvent {
    const { time, selfId, groupId, memberUid, adminUid } = common;
    return {
        time,
        self_id: selfId,
        post_type: "notice",
        notice_type: "group_increase",
        sub_type: adminUid === memberUid ? "approve" : "invite",
        group_id: groupId,
        operator_id: toUin(adminUid, ctx),
        user_id: toUin(memberUid, ctx),
    };
}

/** 群成员退出（leave）。 */
function toQuit(
    common: GroupChangeCommon,
    ctx: NoticeTranslateContext,
): OB11GroupDecreaseNoticeEvent {
    const { time, selfId, groupId, memberUid, adminUid } = common;
    return {
        time,
        self_id: selfId,
        post_type: "notice",
        notice_type: "group_decrease",
        sub_type: "leave",
        group_id: groupId,
        operator_id: toUin(adminUid, ctx),
        user_id: toUin(memberUid, ctx),
    };
}

/** 管理员变更（BLOCK=set / UNBLOCK=unset）。 */
function toAdminChange(
    common: GroupChangeCommon,
    grp: TipGroupElement,
    ctx: NoticeTranslateContext,
): OB11GroupAdminNoticeEvent {
    const { time, selfId, groupId, memberUid, adminUid } = common;
    return {
        time,
        self_id: selfId,
        post_type: "notice",
        notice_type: "group_admin",
        sub_type: grp.type === TipGroupElementType.BLOCK ? "set" : "unset",
        group_id: groupId,
        user_id: toUin(memberUid === "" ? adminUid : memberUid, ctx),
    };
}

/** 禁言（duration>0=ban / 否则 lift_ban）。 */
function toBan(
    common: GroupChangeCommon,
    grp: TipGroupElement,
    ctx: NoticeTranslateContext,
): OB11GroupBanNoticeEvent {
    const { time, selfId, groupId, adminUid, memberUid } = common;
    const shutUp = grp.shutUp;
    return {
        time,
        self_id: selfId,
        post_type: "notice",
        notice_type: "group_ban",
        sub_type: Number(shutUp?.duration ?? 0) > 0 ? "ban" : "lift_ban",
        group_id: groupId,
        operator_id: toUin(shutUp?.admin?.uid ?? adminUid, ctx),
        user_id: toUin(shutUp?.member?.uid ?? memberUid, ctx),
        duration: Number(shutUp?.duration ?? 0),
    };
}

/** 单个 grayTip 元素 → notice 事件（null = 不可翻译；未知子类型打 raw 日志）。 */
function translateGrayTip(
    msg: RawMessage,
    g: GrayTipElement,
    ctx: NoticeTranslateContext,
): OB11Event | null {
    const subType = g.subElementType;
    if (subType === GrayTipSubType.REVOKE) {
        return toRecall(msg, g, ctx);
    }
    if (subType === GrayTipSubType.GROUP) {
        return toGroupChange(msg, g, ctx);
    }
    if (g.aioOpGrayTipElement !== undefined) {
        // poke（aioOp）：subElementType 归属未实证（BUDDY_NOTIFY/GROUP_NOTIFY 载荷），
        // 以元素存在性识别；始终打 raw 日志（toPoke 内）
        return toPoke(msg, g, ctx);
    }
    // 未知/未翻译子类型：raw 日志（JSON/BUDDY/ESSENCE/GROUP_NOTIFY/FILE 等——
    // friend_add/lucky_notify/honor/essence 等翻译的数据源校准入口）
    ctx.logger?.warn(
        { subType, raw: JSON.stringify(g)?.slice(0, 2000) },
        "ob11: 未翻译的 grayTip 子类型（raw 校准数据）",
    );
    return null;
}

/** RawMessage → OB11 notice 事件（无 grayTip 返回 null）。
 * 未知/未翻译子类型打 raw JSON 日志（校准数据积累，2026-09-08）。 */
export function toOb11NoticeEvent(msg: RawMessage, ctx: NoticeTranslateContext): OB11Event | null {
    for (const el of msg.elements) {
        const g = el.grayTipElement;
        if (g === undefined) {
            continue;
        }
        const event = translateGrayTip(msg, g, ctx);
        if (event !== null) {
            return event;
        }
    }
    return null;
}
