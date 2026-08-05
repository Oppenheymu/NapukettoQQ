/**
 * cache/ 聚合出口（ADR-008）：群/成员缓存（P2-17）。
 * 后续扩展：好友缓存（BuddyCache）、资料缓存（ProfileCache）。
 */

export type { GroupCacheOptions } from "./group-cache.js";
export { GroupCache } from "./group-cache.js";
