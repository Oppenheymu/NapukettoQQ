/**
 * kernel 原生监听器类型（事件通道泛型参数）
 *
 * group / msg 两个方向的 listener 契约，由 bridge 层消费。
 */
export type { GroupListener, GroupMemberListChange } from "./group.js";
export { GroupListUpdateType, GroupMemberDataSource } from "./group.js";
export type { MsgListener, MsgReadReportItem, MsgReceipt } from "./msg.js";
