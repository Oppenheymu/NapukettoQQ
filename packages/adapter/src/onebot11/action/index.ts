/**
 * OneBot 11 动作注册表（ADR-013 延伸）
 * 各协议维护自己的 ActionRegistry，由协议 adapter 挂到请求分发。
 */
import type { FriendApi, GroupApi } from "@napuketto/kernel";
import { ActionRegistry } from "../../core/index.js";
import { GetFriendListAction } from "./get-friend-list.js";
import { GetGroupInfoAction } from "./get-group-info.js";
import { GetGroupListAction } from "./get-group-list.js";
import { GetGroupMemberInfoAction } from "./get-group-member-info.js";
import { GetGroupMemberListAction } from "./get-group-member-list.js";
import { GetLoginInfoAction } from "./get-login-info.js";
import type { SendMsgDeps } from "./send-msg.js";
import { SendMsgAction } from "./send-msg.js";

/** 动作注册表依赖（各动作所需的 kernel API 由装配方注入）。 */
export interface Ob11ActionDeps {
    /** kernel 消息 API（send_msg 用）。 */
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
    registry.register(new SendMsgAction(deps.sendMsg));
    registry.register(new GetLoginInfoAction(deps.self));
    registry.register(new GetGroupInfoAction(deps.groupApi));
    registry.register(new GetGroupListAction(deps.groupApi));
    registry.register(new GetGroupMemberInfoAction(deps.groupApi));
    registry.register(new GetGroupMemberListAction(deps.groupApi));
    registry.register(new GetFriendListAction(deps.friendApi));
    return registry;
}
