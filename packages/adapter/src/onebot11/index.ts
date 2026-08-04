/**
 * OneBot 11 协议适配器（当前主战场）
 * 公共面：类型 + 动作注册表 + 配置 schema（adapter.ts 于 P2 打通 kernel 事件后接入）。
 */

export { createOb11ActionRegistry } from "./action/index.js";
export { ob11ErrorCodeMap } from "./action/send-msg.js";
export type { OB11Config } from "./helper/index.js";
export { ob11ConfigSchema } from "./helper/index.js";
export type {
    GroupInfo,
    LoginInfo,
    OB11Message,
    OB11MessageEvent,
    OB11MessageSegment,
    OB11Return,
    Sender,
} from "./types/index.js";
