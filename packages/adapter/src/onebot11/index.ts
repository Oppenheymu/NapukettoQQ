/**
 * OneBot 11 协议适配器（当前主战场）
 * 公共面：类型 + 动作注册表 + 配置 schema + 翻译层（adapter.ts 于 P2 打通 kernel 事件后接入）。
 */

export { createOb11ActionRegistry } from "./action/index.js";
export { ob11ErrorCodeMap } from "./action/send-msg.js";
export type {
    OB11BaseEvent,
    OB11Event,
    OB11FriendRequestEvent,
    OB11GroupMessageEvent,
    OB11GroupRequestEvent,
    OB11HeartbeatMetaEvent,
    OB11LifecycleMetaEvent,
    OB11MessageEvent,
    OB11MetaEvent,
    OB11NoticeEvent,
    OB11PostType,
    OB11PrivateMessageEvent,
    OB11RequestEvent,
    OB11Status,
} from "./event/index.js";
export type { CqCode, OB11Config } from "./helper/index.js";
export {
    canonicalToCqMessage,
    canonicalToSegments,
    cqMessageToCanonical,
    cqMessageToSegments,
    encodeCqCode,
    escapeCqParam,
    escapeCqText,
    ob11ConfigSchema,
    parseCqMessage,
    segmentsToCanonical,
    segmentsToCqMessage,
    serializeCqParts,
    unescapeCqText,
} from "./helper/index.js";
export type {
    GroupInfo,
    LoginInfo,
    OB11Message,
    OB11MessageSegment,
    OB11Return,
    Sender,
} from "./types/index.js";
