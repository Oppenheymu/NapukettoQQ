/**
 * Satori helper 出口（元素编解码 + 配置 + 错误映射 + ID 构造）。
 */

export type { CanonicalToSatoriDeps } from "./canonical.js";
export { canonicalToSatoriElements } from "./canonical.js";
export type { SatoriConfig } from "./config.js";
export { satoriConfigSchema } from "./config.js";
export type { SatoriElement } from "./element.js";
export { parseElements, renderElements } from "./element.js";
export type { SatoriToCanonicalDeps } from "./element-convert.js";
export { parseContentToCanonical, satoriToCanonicalElements } from "./element-convert.js";
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
