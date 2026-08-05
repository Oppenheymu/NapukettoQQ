/**
 * OneBot 11 动作注册表（ADR-013 延伸）
 * 各协议维护自己的 ActionRegistry，由协议 adapter 挂到请求分发。
 */
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
}

/** 构建 OB11 动作注册表（所有 OB11 动作在此注册）。 */
export function createOb11ActionRegistry(deps: Ob11ActionDeps): ActionRegistry {
    const registry = new ActionRegistry();
    registry.register(new SendMsgAction(deps.sendMsg));
    registry.register(new GetLoginInfoAction());
    registry.register(new GetGroupInfoAction());
    registry.register(new GetGroupListAction());
    registry.register(new GetGroupMemberInfoAction());
    registry.register(new GetGroupMemberListAction());
    registry.register(new GetFriendListAction());
    return registry;
}
