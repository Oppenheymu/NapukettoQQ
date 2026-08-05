/**
 * OneBot 11 动作注册表（ADR-013 延伸）
 * 各协议维护自己的 ActionRegistry，由协议 adapter 挂到请求分发。
 */
import type { FriendApi, GroupApi, GroupNotifyApi, TicketApi } from "@napuketto/kernel";
import { ActionRegistry } from "../../core/index.js";
import { DeleteFriendAction } from "./friend/delete-friend.js";
import { GetDoubtFriendsAddRequestAction } from "./friend/get-doubt-friends-add-request.js";
import { GetFriendListAction } from "./friend/get-friend-list.js";
import { GetFriendsWithCategoryAction } from "./friend/get-friends-with-category.js";
import { SetDoubtFriendsAddRequestAction } from "./friend/set-doubt-friends-add-request.js";
import { SetFriendAddRequestAction } from "./friend/set-friend-add-request.js";
import { SetFriendRemarkAction } from "./friend/set-friend-remark.js";
import { DeleteEssenceMsgAction } from "./group/delete-essence-msg.js";
import { GetGroupAtAllRemainAction } from "./group/get-group-at-all-remain.js";
import { GetGroupInfoAction } from "./group/get-group-info.js";
import { GetGroupListAction } from "./group/get-group-list.js";
import { GetGroupMemberInfoAction } from "./group/get-group-member-info.js";
import { GetGroupMemberListAction } from "./group/get-group-member-list.js";
import { GetGroupShutListAction } from "./group/get-group-shut-list.js";
import { GetGroupSystemMsgAction } from "./group/get-group-system-msg.js";
import { SetEssenceMsgAction } from "./group/set-essence-msg.js";
import { SetGroupAddRequestAction } from "./group/set-group-add-request.js";
import { SetGroupAdminAction } from "./group/set-group-admin.js";
import { SetGroupBanAction } from "./group/set-group-ban.js";
import { SetGroupCardAction } from "./group/set-group-card.js";
import { SetGroupKickAction } from "./group/set-group-kick.js";
import { SetGroupLeaveAction } from "./group/set-group-leave.js";
import { SetGroupNameAction } from "./group/set-group-name.js";
import { SetGroupWholeBanAction } from "./group/set-group-whole-ban.js";
import { DeleteMsgAction } from "./message/delete-msg.js";
import { FetchPttTextAction } from "./message/fetch-ptt-text.js";
import {
    ForwardFriendSingleMsgAction,
    ForwardGroupSingleMsgAction,
} from "./message/forward-single-msg.js";
import { GetForwardMsgAction } from "./message/get-forward-msg.js";
import { GetFriendMsgHistoryAction } from "./message/get-friend-msg-history.js";
import { GetGroupMsgHistoryAction } from "./message/get-group-msg-history.js";
import { GetMsgAction } from "./message/get-msg.js";
import { MarkMsgAsReadAction } from "./message/mark-msg-as-read.js";
import {
    MarkGroupMsgAsReadAction,
    MarkPrivateMsgAsReadAction,
} from "./message/mark-msg-as-read-aliases.js";
import {
    SendGroupForwardMsgAction,
    SendPrivateForwardMsgAction,
} from "./message/send-forward-msg.js";
import { SendGroupMsgAction } from "./message/send-group-msg.js";
import type { SendMsgDeps } from "./message/send-msg.js";
import { SendMsgAction } from "./message/send-msg.js";
import { SendPrivateMsgAction } from "./message/send-private-msg.js";
import { SetInputStatusAction } from "./message/set-input-status.js";
import { SetMsgEmojiLikeAction } from "./message/set-msg-emoji-like.js";
import { CanSendImageAction } from "./system/can-send-image.js";
import { CanSendRecordAction } from "./system/can-send-record.js";
import type { CleanCacheDeps } from "./system/clean-cache.js";
import { CleanCacheAction } from "./system/clean-cache.js";
import type { DownloadFileDeps } from "./system/download-file.js";
import { DownloadFileAction } from "./system/download-file.js";
import { GetClientkeyAction } from "./system/get-clientkey.js";
import { GetCookiesAction } from "./system/get-cookies.js";
import { GetLoginInfoAction } from "./system/get-login-info.js";
import { GetRobotUinRangeAction } from "./system/get-robot-uin-range.js";
import { GetStatusAction } from "./system/get-status.js";
import { GetVersionInfoAction } from "./system/get-version-info.js";
import type { ProcessControlDeps } from "./system/process-control.js";
import { BotExitAction, SetRestartAction } from "./system/process-control.js";
import { SetDiyOnlineStatusAction } from "./system/set-diy-online-status.js";
import { SetOnlineStatusAction } from "./system/set-online-status.js";

/** 动作注册表依赖（各动作所需的 kernel API 由装配方注入）。 */
export interface Ob11ActionDeps {
    /** kernel 消息 API（send_msg 等消息类动作用）。 */
    sendMsg: SendMsgDeps;
    /** kernel 群 API。 */
    groupApi: GroupApi;
    /** kernel 群通知 API（群请求/禁言列表用，P2-13）。 */
    groupNotifyApi: GroupNotifyApi;
    /** kernel 好友 API。 */
    friendApi: FriendApi;
    /** kernel 票据 API（get_clientkey/get_cookies 用，P2-13）。 */
    ticketApi: TicketApi;
    /** 登录身份（get_login_info 用）。 */
    self: { uin: string; nickname: string };
    /** 系统类本地信息（get_version_info / clean_cache / download_file / 进程控制用）。 */
    system: {
        appVersion: string;
        cleanCache?: () => Promise<void>;
        cacheDir?: string;
        exit?: () => Promise<void>;
        restart?: () => Promise<void>;
    };
}

/** 构建 OB11 动作注册表（所有 OB11 动作在此注册，按组拆分控制行数）。 */
export function createOb11ActionRegistry(deps: Ob11ActionDeps): ActionRegistry {
    const registry = new ActionRegistry();
    registerMsgActions(registry, deps);
    registerForwardActions(registry, deps);
    registerQueryActions(registry, deps);
    registerGroupActions(registry, deps);
    registerFriendActions(registry, deps);
    registerSystemActions(registry, deps);
    registerGroupNotifyActions(registry, deps);
    registerTicketActions(registry, deps);
    return registry;
}

/** 群通知/禁言列表动作（P2-13）。 */
function registerGroupNotifyActions(registry: ActionRegistry, deps: Ob11ActionDeps): void {
    registry.register(new SetGroupAddRequestAction(deps.groupNotifyApi));
    registry.register(
        new GetGroupSystemMsgAction({
            groupNotifyApi: deps.groupNotifyApi,
            uidToUin: (uids) => deps.groupApi.uidToUin(uids),
        }),
    );
    registry.register(
        new GetGroupShutListAction({
            groupNotifyApi: deps.groupNotifyApi,
            uidToUin: (uids) => deps.groupApi.uidToUin(uids),
        }),
    );
}

/** 票据动作（P2-13）。 */
function registerTicketActions(registry: ActionRegistry, deps: Ob11ActionDeps): void {
    registry.register(new GetClientkeyAction(deps.ticketApi));
    registry.register(new GetCookiesAction({ ticketApi: deps.ticketApi, selfUin: deps.self.uin }));
}

/** 合并转发 / 单条转发 / 在线状态（P2-12）。 */
function registerForwardActions(registry: ActionRegistry, deps: Ob11ActionDeps): void {
    registry.register(new SendGroupForwardMsgAction(deps.sendMsg));
    registry.register(new SendPrivateForwardMsgAction(deps.sendMsg));
    registry.register(new GetForwardMsgAction(deps.sendMsg));
    registry.register(new ForwardGroupSingleMsgAction(deps.sendMsg));
    registry.register(new ForwardFriendSingleMsgAction(deps.sendMsg));
    registry.register(new SetOnlineStatusAction(deps.sendMsg.msgApi));
    registry.register(new SetDiyOnlineStatusAction(deps.sendMsg.msgApi));
}

/** 消息类动作（P2-3 / P2-10 / P2-11）。 */
function registerMsgActions(registry: ActionRegistry, deps: Ob11ActionDeps): void {
    registry.register(new SendMsgAction(deps.sendMsg));
    registry.register(new SendPrivateMsgAction(deps.sendMsg));
    registry.register(new SendGroupMsgAction(deps.sendMsg));
    registry.register(new DeleteMsgAction(deps.sendMsg));
    registry.register(new GetMsgAction(deps.sendMsg));
    registry.register(new GetGroupMsgHistoryAction(deps.sendMsg));
    registry.register(new GetFriendMsgHistoryAction(deps.sendMsg));
    registry.register(new MarkMsgAsReadAction(deps.sendMsg));
    registry.register(new MarkPrivateMsgAsReadAction(deps.sendMsg));
    registry.register(new MarkGroupMsgAsReadAction(deps.sendMsg.msgApi));
    registry.register(new SetMsgEmojiLikeAction(deps.sendMsg));
    registry.register(new FetchPttTextAction(deps.sendMsg));
    registry.register(new SetInputStatusAction(deps.sendMsg));
}

/** 查询类动作（P2-4）。 */
function registerQueryActions(registry: ActionRegistry, deps: Ob11ActionDeps): void {
    registry.register(new GetLoginInfoAction(deps.self));
    registry.register(new GetGroupInfoAction(deps.groupApi));
    registry.register(new GetGroupListAction(deps.groupApi));
    registry.register(new GetGroupMemberInfoAction(deps.groupApi));
    registry.register(new GetGroupMemberListAction(deps.groupApi));
    registry.register(new GetFriendListAction(deps.friendApi));
}

/** 群管类动作（P2-10）。 */
function registerGroupActions(registry: ActionRegistry, deps: Ob11ActionDeps): void {
    registry.register(new SetGroupKickAction(deps.groupApi));
    registry.register(new SetGroupBanAction(deps.groupApi));
    registry.register(new SetGroupWholeBanAction(deps.groupApi));
    registry.register(new SetGroupAdminAction(deps.groupApi));
    registry.register(new SetGroupCardAction(deps.groupApi));
    registry.register(new SetGroupNameAction(deps.groupApi));
    registry.register(new SetGroupLeaveAction(deps.groupApi));
    registry.register(
        new SetEssenceMsgAction({
            groupApi: deps.groupApi,
            messageUnique: deps.sendMsg.messageUnique,
        }),
    );
    registry.register(
        new DeleteEssenceMsgAction({
            groupApi: deps.groupApi,
            messageUnique: deps.sendMsg.messageUnique,
        }),
    );
    registry.register(new GetGroupAtAllRemainAction(deps.groupApi));
}

/** 好友类动作（P2-11）。 */
function registerFriendActions(registry: ActionRegistry, deps: Ob11ActionDeps): void {
    registry.register(new SetFriendAddRequestAction(deps.friendApi));
    registry.register(
        new SetFriendRemarkAction({
            friendApi: deps.friendApi,
            uinToUid: deps.sendMsg.uinToUid,
        }),
    );
    registry.register(
        new DeleteFriendAction({
            friendApi: deps.friendApi,
            uinToUid: deps.sendMsg.uinToUid,
        }),
    );
    registry.register(new GetFriendsWithCategoryAction(deps.friendApi));
    registry.register(new GetDoubtFriendsAddRequestAction(deps.friendApi));
    registry.register(new SetDoubtFriendsAddRequestAction(deps.friendApi));
}

/** 系统类动作（P2-11 / P2-12）。 */
function registerSystemActions(registry: ActionRegistry, deps: Ob11ActionDeps): void {
    registry.register(new GetStatusAction());
    registry.register(new GetVersionInfoAction({ appVersion: deps.system.appVersion }));
    const cleanCacheDeps: CleanCacheDeps = {};
    if (deps.system.cleanCache !== undefined) {
        cleanCacheDeps.cleanCache = deps.system.cleanCache;
    }
    registry.register(new CleanCacheAction(cleanCacheDeps));
    registry.register(new CanSendImageAction());
    registry.register(new CanSendRecordAction());
    registry.register(new GetRobotUinRangeAction());
    const downloadDeps: DownloadFileDeps = {};
    if (deps.system.cacheDir !== undefined) {
        downloadDeps.cacheDir = deps.system.cacheDir;
    }
    registry.register(new DownloadFileAction(downloadDeps));
    const processDeps: ProcessControlDeps = {};
    if (deps.system.exit !== undefined) {
        processDeps.exit = deps.system.exit;
    }
    if (deps.system.restart !== undefined) {
        processDeps.restart = deps.system.restart;
    }
    registry.register(new BotExitAction(processDeps));
    registry.register(new SetRestartAction(processDeps));
}
