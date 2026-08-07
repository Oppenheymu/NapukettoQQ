/**
 * Satori helper 出口（元素编解码 + 配置 + 错误映射 + ID 构造）。
 */

export type { SatoriConfig } from "./config.js";
export { satoriConfigSchema } from "./config.js";
export type { CanonicalToSatoriDeps, SatoriElement, SatoriToCanonicalDeps } from "./element.js";
export {
    canonicalToSatoriElements,
    parseContentToCanonical,
    parseElements,
    renderElements,
    satoriToCanonicalElements,
} from "./element.js";
export { HTTP_STATUS, satoriHttpStatusMap } from "./error.js";
export {
    ADAPTER,
    FEATURES,
    isGroupChannel,
    PLATFORM,
    toDirectChannel,
    toGroupChannel,
    toGuild,
    toLogin,
    toMinimalLogin,
    toUser,
} from "./ids.js";
