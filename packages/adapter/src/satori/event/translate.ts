/**
 * Satori 事件翻译（kernel RawMessage → Satori Event 内容，纯函数 + 注入转换）
 *
 * 第一版支持：
 *  - message-created：普通消息（Msg/onRecvMsg）
 *  - message-deleted：grayTip REVOKE（撤回）
 *  - guild-member-added / guild-member-removed：grayTip GROUP（TipGroupElement）
 * （friend-request / guild-request 事件留待后续：grayTip 的 jsonGrayTipElement
 *  结构待运行时探测，OB11 走主动查询 get_group_system_msg 不广播。）
 *
 * 收方向 ID 空间：uid → uin 批量转换（deps.uidToUin，与消息翻译同依赖）。
 */
import { ChatType, GrayTipSubType, type RawMessage, TipGroupElementType } from "@napuketto/kernel";
import { toUser } from "../helper/ids.js";
import { type SatoriTranslateDeps, toSatoriMessage } from "../helper/translate.js";
import type { Channel, Guild, GuildMember, Message, User } from "../types/resource.js";

/** 事件内容（不含 sn/login，由 adapter 包一层完整 Event）。 */
export interface SatoriEventContent {
    type: string;
    timestamp: number;
    channel?: Channel;
    guild?: Guild;
    message?: Message;
    user?: User;
    member?: GuildMember;
    operator?: User;
}

/** 事件翻译依赖（selfUin + uidToUin）。 */
export interface SatoriEventDeps extends SatoriTranslateDeps {}

/** 普通消息 → message-created 事件。 */
export async function toSatoriMessageEvent(
    raw: RawMessage,
    deps: SatoriEventDeps,
): Promise<SatoriEventContent> {
    const message = await toSatoriMessage(raw, deps);
    const content: SatoriEventContent = {
        type: "message-created",
        timestamp: Number(raw.msgTime),
    };
    if (message.channel !== undefined) {
        content.channel = message.channel;
    }
    if (message.guild !== undefined) {
        content.guild = message.guild;
    }
    if (message.user !== undefined) {
        content.user = message.user;
    }
    if (message.member !== undefined) {
        content.member = message.member;
    }
    content.message = message;
    return content;
}

/** 检查消息是否含可翻译的 grayTip（撤回 / 群成员变动）。 */
export function hasSatoriGrayTip(raw: RawMessage): boolean {
    for (const el of raw.elements) {
        const g = el.grayTipElement;
        if (g === undefined) {
            continue;
        }
        if (
            g.subElementType === GrayTipSubType.REVOKE ||
            g.subElementType === GrayTipSubType.GROUP
        ) {
            return true;
        }
    }
    return false;
}

/** 收集 grayTip 涉及的 uid（批量 uidToUin 用）。 */
export function collectSatoriGrayTipUids(raw: RawMessage): string[] {
    const uids = new Set<string>();
    for (const el of raw.elements) {
        const g = el.grayTipElement;
        if (g === undefined) {
            continue;
        }
        const revoke = g.revokeElement;
        if (revoke?.operatorUid !== undefined && revoke.operatorUid !== "") {
            uids.add(revoke.operatorUid);
        }
        const grp = g.groupElement;
        if (grp === undefined) {
            continue;
        }
        if (grp.memberUid !== undefined && grp.memberUid !== "") {
            uids.add(grp.memberUid);
        }
        if (grp.adminUid !== undefined && grp.adminUid !== "") {
            uids.add(grp.adminUid);
        }
    }
    return [...uids];
}

/** 判断消息是否为群聊 grayTip（peerUid 是群号）。 */
function isGroupMessage(raw: RawMessage): boolean {
    return raw.chatType === ChatType.GROUP;
}

/** grayTip → 事件（撤回 / 群成员变动；无匹配返回 null）。 */
export async function toSatoriGrayTipEvent(
    raw: RawMessage,
    uidToUinMap: Map<string, string>,
): Promise<SatoriEventContent | null> {
    for (const el of raw.elements) {
        const g = el.grayTipElement;
        if (g === undefined) {
            continue;
        }
        if (g.subElementType === GrayTipSubType.REVOKE) {
            const revoked = toRevokeEvent(raw, uidToUinMap);
            if (revoked !== null) {
                return revoked;
            }
        }
        if (g.subElementType === GrayTipSubType.GROUP && isGroupMessage(raw)) {
            const member = toMemberChangeEvent(raw, uidToUinMap);
            if (member !== null) {
                return member;
            }
        }
    }
    return null;
}

/** uid → uin（映射缺省退化为 uid）。 */
function toUin(uid: string, uidToUinMap: Map<string, string>): string {
    return uidToUinMap.get(uid) ?? uid;
}

/** 撤回 → message-deleted 事件。 */
function toRevokeEvent(
    raw: RawMessage,
    uidToUinMap: Map<string, string>,
): SatoriEventContent | null {
    for (const el of raw.elements) {
        const revoke = el.grayTipElement?.revokeElement;
        if (revoke === undefined) {
            continue;
        }
        const operatorUin = toUin(revoke.operatorUid, uidToUinMap);
        const peerUin = String(raw.peerUin ?? "");
        const content: SatoriEventContent = {
            type: "message-deleted",
            timestamp: Number(raw.msgTime),
        };
        content.channel = {
            id: peerUin,
            type: isGroupMessage(raw) ? 0 : 1,
        };
        if (isGroupMessage(raw)) {
            content.guild = { id: peerUin, name: raw.peerName };
        }
        // 撤回消息的 id：NT 侧仅 grayTip 的 msgSeq 可用（对齐 OB11 message_id 语义）
        content.message = { id: raw.msgSeq };
        content.operator = toUser(operatorUin, revoke.operatorNick);
        return content;
    }
    return null;
}

/** 群成员变动 → guild-member-added / guild-member-removed 事件。 */
function toMemberChangeEvent(
    raw: RawMessage,
    uidToUinMap: Map<string, string>,
): SatoriEventContent | null {
    for (const el of raw.elements) {
        const grp = el.grayTipElement?.groupElement;
        if (grp === undefined || grp.type === undefined) {
            continue;
        }
        const memberUid = grp.memberUid ?? "";
        const adminUid = grp.adminUid ?? "";
        const peerUin = String(raw.peerUin ?? "");
        const guild: Guild = { id: peerUin };
        if (raw.peerName !== undefined && raw.peerName !== "") {
            guild.name = raw.peerName;
        }
        const channel: Channel = { id: peerUin, type: 0 };
        let type: string | null = null;
        if (grp.type === TipGroupElementType.MEMBER_ADD) {
            type = "guild-member-added";
        } else if (grp.type === TipGroupElementType.QUIT) {
            type = "guild-member-removed";
        }
        if (type === null) {
            return null;
        }
        const memberUin = toUin(memberUid, uidToUinMap);
        const nick = grp.memberNick ?? "";
        const user = toUser(memberUin, nick);
        const member: GuildMember = { user };
        if (
            grp.memberRemark !== undefined &&
            grp.memberRemark !== "" &&
            grp.memberRemark !== nick
        ) {
            member.nick = grp.memberRemark;
        }
        const content: SatoriEventContent = {
            type,
            timestamp: Number(raw.msgTime),
            guild,
            channel,
            member,
            user,
        };
        if (adminUid !== "" && adminUid !== memberUid) {
            const operatorUin = toUin(adminUid, uidToUinMap);
            content.operator = toUser(operatorUin, grp.adminNick);
        }
        return content;
    }
    return null;
}
