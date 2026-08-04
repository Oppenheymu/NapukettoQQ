/**
 * 实体类型层（运行时探测产物，ADR-006）
 *
 * ⚠️ 占位：以下为最小可编译占位，字段集合待 `scripts/probe/` 探测脚本
 * 加载 wrapper.node 后按实体 JSON 日志产出（P1 目标），勿以本文件为准。
 */

/** QQ 消息（RawMessage 占位）。 */
export interface RawMessage {
    msgId: string;
    msgSeq: string;
    peer: Peer;
    elements: RawElement[];
}

/** 会话对象（占位）。 */
export interface Peer {
    chatType: number;
    peerUid: string;
    guildId?: string;
}

/** 消息元素（占位）。 */
export interface RawElement {
    elementType: number;
    [key: string]: unknown;
}
