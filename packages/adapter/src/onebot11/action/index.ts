/**
 * OneBot 11 动作注册表（ADR-013 延伸）
 * 各协议维护自己的 ActionRegistry，由协议 adapter 挂到请求分发。
 */
import type { FriendApi, GroupApi } from "@napuketto/kernel";
import { ActionRegistry } from "../../core/index.js";
import { DeleteEssenceMsgAction } from "./delete-essence-msg.js";
import { DeleteMsgAction } from "./delete-msg.js";
import { FetchPttTextAction } from "./fetch-ptt-text.js";
import { GetFriendListAction } from "./get-friend-list.js";
import { GetFriendMsgHistoryAction } from "./get-friend-msg-history.js";
import { GetGroupAtAllRemainAction } from "./get-group-at-all-remain.js";
import { GetGroupInfoAction } from "./get-group-info.js";
import { GetGroupListAction } from "./get-group-list.js";
import { GetGroupMemberInfoAction } from "./get-group-member-info.js";
import { GetGroupMemberListAction } from "./get-group-member-list.js";
import { GetGroupMsgHistoryAction } from "./get-group-msg-history.js";
import { GetLoginInfoAction } from "./get-login-info.js";
import { GetMsgAction } from "./get-msg.js";
import { MarkMsgAsReadAction } from "./mark-msg-as-read.js";
import { SendGroupMsgAction } from "./send-group-msg.js";
import type { SendMsgDeps } from "./send-msg.js";
import { SendMsgAction } from "./send-msg.js";
import { SendPrivateMsgAction } from "./send-private-msg.js";
import { SetEssenceMsgAction } from "./set-essence-msg.js";
import { SetGroupAdminAction } from "./set-group-admin.js";
import { SetGroupBanAction } from "./set-group-ban.js";
import { SetGroupCardAction } from "./set-group-card.js";
import { SetGroupKickAction } from "./set-group-kick.js";
import { SetGroupLeaveAction } from "./set-group-leave.js";
import { SetGroupNameAction } from "./set-group-name.js";
import { SetGroupWholeBanAction } from "./set-group-whole-ban.js";
import { SetMsgEmojiLikeAction } from "./set-msg-emoji-like.js";

/** 动作注册表依赖（各动作所需的 kernel API 由装配方注入）。 */
export interface Ob11ActionDeps {
    /** kernel 消息 API（send_msg 等消息类动作用）。 */
    sendMsg: SendMsgDeps;
    /** kernel 群 API。 */
    groupApi: GroupApi;
    /** kernel 好友 API。 */
    friendApi: FriendApi;
    /** 登录身份（get_login_info 用）。 */
    self: { uin: string; nickname: string };
}

/** 构建 OB11 动作注册表（所有 OB11 动作在此注册）。 */
export function createOb11ActionRegistry(deps: Ob11ActionDeps): ActionRegistry {
    const registry = new ActionRegistry();
    // 消息类（P2-3 / P2-10）
    registry.register(new SendMsgAction(deps.sendMsg));
    registry.register(new SendPrivateMsgAction(deps.sendMsg));
    registry.register(new SendGroupMsgAction(deps.sendMsg));
    registry.register(new DeleteMsgAction(deps.sendMsg));
    registry.register(new GetMsgAction(deps.sendMsg));
    registry.register(new GetGroupMsgHistoryAction(deps.sendMsg));
    registry.register(new GetFriendMsgHistoryAction(deps.sendMsg));
    registry.register(new MarkMsgAsReadAction(deps.sendMsg));
    registry.register(new SetMsgEmojiLikeAction(deps.sendMsg));
    registry.register(new FetchPttTextAction(deps.sendMsg));
    // 查询类（P2-4）
    registry.register(new GetLoginInfoAction(deps.self));
    registry.register(new GetGroupInfoAction(deps.groupApi));
    registry.register(new GetGroupListAction(deps.groupApi));
    registry.register(new GetGroupMemberInfoAction(deps.groupApi));
    registry.register(new GetGroupMemberListAction(deps.groupApi));
    registry.register(new GetFriendListAction(deps.friendApi));
    // 群管类（P2-10）
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
    return registry;
}
