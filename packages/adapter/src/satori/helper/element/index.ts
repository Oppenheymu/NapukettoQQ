/**
 * helper/element：Satori 消息元素域（从 helper/ 根拆分，2026-08-08 DDD 重组）
 *
 * 解析/渲染（element.ts + parse-tag.ts）、canonical 双向转换（element-convert /
 * canonical / media-convert）、资源处理（asset.ts）。对外统一走本 barrel，
 * 组内文件保持相对引用。
 */
export type { CanonicalToSatoriDeps } from "./canonical.js";
export { canonicalToSatoriElements } from "./canonical.js";
export type { SatoriElement } from "./element.js";
export { parseElements, renderElements } from "./element.js";
export type { SatoriToCanonicalDeps } from "./element-convert.js";
export {
    parseContentToCanonical,
    satoriToCanonicalElements,
} from "./element-convert.js";
