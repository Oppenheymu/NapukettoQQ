/**
 * RawMessage 数组规范化（OB11 / Satori 共用，2026-08-08 克隆合并）
 *
 * onRecvMsg 回调参数运行时实证为消息数组（2026-08-07），但兼容单条对象
 * 传入——统一规范化为数组并过滤无效项后逐条回调。
 */
import type { RawMessage } from "@napuketto/kernel";

/** 逐条处理消息（自动规范化数组 + 过滤非对象项）。 */
export function forEachRawMessage(msgs: unknown, handler: (msg: RawMessage) => void): void {
    const list = Array.isArray(msgs) ? msgs : [msgs];
    for (const msg of list) {
        if (!msg || typeof msg !== "object") {
            continue;
        }
        handler(msg as RawMessage);
    }
}
