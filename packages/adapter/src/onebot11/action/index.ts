/**
 * OneBot 11 动作注册表（ADR-013 延伸）
 * 各协议维护自己的 ActionRegistry，由协议 adapter 挂到请求分发。
 */
import { ActionRegistry } from "../../core/index.js";
import { SendMsgAction } from "./send-msg.js";

/** 构建 OB11 动作注册表（所有 OB11 动作在此注册）。 */
export function createOb11ActionRegistry(): ActionRegistry {
    const registry = new ActionRegistry();
    registry.register(new SendMsgAction());
    return registry;
}
