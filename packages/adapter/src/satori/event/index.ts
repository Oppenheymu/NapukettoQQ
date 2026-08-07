/**
 * Satori 事件出口（事件翻译）。
 */

export type { SatoriEventContent, SatoriEventDeps } from "./translate.js";
export {
    collectSatoriGrayTipUids,
    hasSatoriGrayTip,
    toSatoriGrayTipEvent,
    toSatoriMessageEvent,
} from "./translate.js";
