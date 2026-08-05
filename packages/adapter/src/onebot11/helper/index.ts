/**
 * OneBot 11 helper：配置 schema（ADR-012）+ 翻译层（canonical ↔ OB11，ADR-008）
 */

export type { OB11Config } from "./config.js";
export { ob11ConfigSchema } from "./config.js";
export type { CqCode } from "./cqcode.js";
export {
    encodeCqCode,
    escapeCqParam,
    escapeCqText,
    parseCqMessage,
    serializeCqParts,
    unescapeCqText,
} from "./cqcode.js";
export {
    canonicalToCqMessage,
    canonicalToSegments,
    cqMessageToCanonical,
    cqMessageToSegments,
    segmentsToCanonical,
    segmentsToCqMessage,
} from "./data.js";
export { MessageUnique } from "./message-unique.js";
export {
    collectGrayTipUids,
    hasGrayTip,
    type NoticeTranslateContext,
    toOb11NoticeEvent,
} from "./notice.js";
export { toOb11GroupInfo, toOb11GroupMemberInfo } from "./translate.js";
