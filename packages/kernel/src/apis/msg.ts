/**
 * MsgApi：消息语义化 API（ADR-009 统一错误语义）
 *
 * 内部解包原生 `{ result, errMsg }`：成功返回纯业务值，失败抛 KernelError。
 * 协议层只维护 `KernelErrorCode → 协议错误码` 映射表，不解析错误逻辑。
 *
 * 方法面（P2-1）：发送 / 撤回 / 拉历史 / 标记已读。group/friend 等后续 apis 同构。
 */
import { kernelError } from "../errors.js";
import type { Peer, RawMessage } from "../types/entities.js";
import type { CanonicalElement } from "../types/message-element.js";
import { toSendElements } from "../types/message-element.js";
import type { GeneralCallResult, NodeIKernelMsgService } from "../types/services/msg-service.js";
import type { NodeIQQNTWrapperSession } from "../types/wrapper.js";

/** 原生结果解包：result !== 0 抛 KernelError（errMsg 语义映射错误码）。 */
function unwrapResult<T extends GeneralCallResult>(label: string, raw: T): void {
    if (raw.result === 0) {
        return;
    }
    const msg = raw.errMsg || "无错误详情";
    let code: "SEND_FAILED" | "NOT_FOUND" | "NOT_LOGIN" | "PERMISSION_DENIED" | "UNKNOWN" =
        "UNKNOWN";
    if (msg.includes("未登录") || msg.includes("login")) {
        code = "NOT_LOGIN";
    } else if (msg.includes("无权限") || msg.includes("permission")) {
        code = "PERMISSION_DENIED";
    } else if (msg.includes("不存在") || msg.includes("not found")) {
        code = "NOT_FOUND";
    } else if (label === "sendMsg") {
        code = "SEND_FAILED";
    }
    throw kernelError(`${label} 失败: ${msg}`, code);
}

/** 消息 API：从 session 拿 msg service，包装成语义化方法。 */
export class MsgApi {
    private readonly service: NodeIKernelMsgService;

    constructor(session: NodeIQQNTWrapperSession) {
        const service = session.getMsgService() as unknown as NodeIKernelMsgService | null;
        if (service === null || service === undefined) {
            throw kernelError("getMsgService() 返回空（session 未 init）", "INVALID_STATE");
        }
        this.service = service;
    }

    /**
     * 发送消息：canonical 元素 → NT 发送元素 → sendMsg。
     * 返回 NT msgId（雪花 ID）。
     */
    async sendMessage(target: Peer, elements: CanonicalElement[]): Promise<{ msgId: string }> {
        const sendElements = toSendElements(elements);
        const msgId = this.service.generateMsgUniqueId(target.chatType, String(Date.now()));
        const raw = await this.service.sendMsg(msgId, target, sendElements, new Map());
        unwrapResult("sendMsg", raw);
        return { msgId };
    }

    /** 撤回消息（群聊管理员 / 私聊 2 分钟内）。 */
    async recallMessage(target: Peer, msgIds: string[]): Promise<void> {
        if (msgIds.length === 0) {
            throw kernelError("recallMessage 需要至少一个 msgId", "INVALID_PARAM");
        }
        const raw = await this.service.recallMsg(target, msgIds);
        unwrapResult("recallMsg", raw);
    }

    /** 拉取历史消息（msgId 为空从最新拉；count 条，时间倒序）。 */
    async fetchMessages(
        target: Peer,
        opts: { count: number; msgId?: string },
    ): Promise<RawMessage[]> {
        const raw = await this.service.getMsgs(target, opts.msgId ?? "", opts.count, false);
        unwrapResult("getMsgs", raw);
        return raw.msgList ?? [];
    }

    /** 标记会话已读。 */
    async markRead(target: Peer): Promise<void> {
        const raw = await this.service.setMsgRead(target);
        unwrapResult("setMsgRead", raw);
    }
}
