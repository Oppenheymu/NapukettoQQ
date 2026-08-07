/**
 * Listener 接口层（运行时探测产物 + 公开资料作说明书，ADR-003 / ADR-006）
 *
 * ⚠️ 部分方法签名为自研描述（wrapper 外部契约作依据理解 QQ），
 * 待下一次进程内探测（probe.ts）校准。事件名约定 `${Service}/${method}`，
 * 由 event-channel 从本接口编译期推导。
 */
import type { RawMessage } from "../entities.js";

/** 消息已读上报（peer + 已读 seq）。 */
export interface MsgReadReportItem {
    peer: unknown;
    readSeq: string;
}

/** 消息回执（msgId + 已读 seq）。 */
export interface MsgReceipt {
    msgId: string;
    readSeq: string;
}

/** 消息服务（MsgService）的原生回调监听接口。
 * 用 type 别名（非 interface）：需满足 ListenerShape（Record<string, unknown>）
 * 约束——interface 无隐式索引签名不兼容；type 对象类型天然满足。
 *
 * ⚠️ 2026-08-07 运行时探测实证（自建宿主，QQ 9.9.33）：onRecvMsg 回调参数是
 * **消息数组**（多条批量推送），非单条 RawMessage——此前单条签名错误（收到数组后
 * msg.msgId/elements 全 undefined）。信号链：原生回调 → MsgBridge 透传数组 →
 * 事件通道 → 订阅方遍历处理。 */
export type MsgListener = {
    /** 收到新消息（批量数组，运行时实证）。 */
    onRecvMsg: (msgs: RawMessage[]) => void;
    /** 消息已读上报。 */
    onRecvMsgReadReport: (reports: MsgReadReportItem[]) => void;
    /** 消息回执。 */
    onRecvMsgReceipt: (receipts: MsgReceipt[]) => void;
};
