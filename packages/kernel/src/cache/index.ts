/**
 * cache/ 聚合出口（ADR-008）：群/成员缓存（P2-17）、好友缓存（B2，2026-09-08）。
 */

export type {
    BuddyCacheEventChannel,
    BuddyCacheListener,
    BuddyCacheOptions,
} from "./buddy-cache.js";
export { BuddyCache, narrowBuddyCategories } from "./buddy-cache.js";
export type { GroupCacheOptions } from "./group-cache.js";
export { GroupCache } from "./group-cache.js";
