/**
 * Listener 接口层（运行时探测产物，ADR-003 / ADR-006）
 *
 * ⚠️ 占位：以下方法签名为「待探测」占位，探测脚本（scripts/probe/）加载
 * wrapper.node 后按运行时反射产出真实签名（P1 目标），勿以本文件为准。
 * 事件名约定 `${Service}/${method}`，由 event-channel 从本接口编译期推导。
 */
import type { RawMessage } from "../entities.js";

/** 消息服务（MsgService）的原生回调监听接口。 */
export interface MsgListener {
    /** 收到新消息（占位签名，待探测）。 */
    onRecvMsg: (msg: RawMessage) => void;
    /** 消息已读上报（占位签名，待探测）。 */
    onRecvMsgReadReport: (peers: Array<{ peer: unknown; readSeq: string }>) => void;
    /** 消息回执（占位签名，待探测）。 */
    onRecvMsgReceipt: (receipt: { msgId: string; readSeq: string }) => void;
}
