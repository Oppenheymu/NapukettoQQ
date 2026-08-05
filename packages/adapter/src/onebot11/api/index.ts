/**
 * OneBot 11 api/ 聚合层出口（P2-16）。
 * OneBotApi：动作统一依赖聚合；后续 cache/（ADR-008）接入后增只读视图。
 */

export type { OneBotApiOptions, OneBotSystemOptions } from "./one-bot-api.js";
export { OneBotApi } from "./one-bot-api.js";
