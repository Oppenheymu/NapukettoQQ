/**
 * OB11 API 聚合层入口
 *
 * OneBotApi：把 9 个 kernel apis + messageUnique + self/system 聚合为
 * 单个动作依赖对象（P2-16）。协议内部只认识这一个聚合面。
 */
export type { OneBotApiOptions, OneBotSystemOptions } from "./one-bot-api.js";
export { OneBotApi } from "./one-bot-api.js";
