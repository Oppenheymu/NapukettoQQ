/**
 * MsgApi：消息语义化 API（ADR-009 统一错误语义）
 *
 * 内部解包原生 `{ result, errMsg }`：成功返回纯业务值，失败抛 KernelError。
 * 协议层只维护 `KernelErrorCode → 协议错误码` 映射表，不解析错误逻辑。
 *
 * 方法面（P2-1）：发送 / 撤回 / 拉历史 / 标记已读。group/friend 等后续 apis 同构。
 */
import { kernelError } from "../infra/errors.js";
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
    /** 上次生成 msgId 的时间（单调递增，2026-08-07 防同毫秒并发碰撞）。 */
    private lastMsgTime = 0;

    constructor(session: NodeIQQNTWrapperSession) {
        const service = session.getMsgService() as unknown as NodeIKernelMsgService | null;
        if (service === null || service === undefined) {
            throw kernelError("getMsgService() 返回空（session 未 init）", "INVALID_STATE");
        }
        this.service = service;
    }

    /**
     * 生成 msgId 时间戳（单调递增）。
     * generateMsgUniqueId(chatType, time) 以 time 区分消息——同毫秒并发发送
     * （机器人群发/多会话同时回复）Date.now() 会碰撞，msgId 相同导致 wrapper
     * 拒绝或覆盖。严格单调递增保证进程内唯一。
     */
    private nextMsgTime(): string {
        const now = Date.now();
        if (now > this.lastMsgTime) {
            this.lastMsgTime = now;
        } else {
            this.lastMsgTime += 1;
        }
        return String(this.lastMsgTime);
    }

    /**
     * 发送消息：canonical 元素 → NT 发送元素 → sendMsg。
     * 返回 NT msgId（雪花 ID）。
     */
    async sendMessage(target: Peer, elements: CanonicalElement[]): Promise<{ msgId: string }> {
        const sendElements = toSendElements(elements);
        const msgId = this.service.generateMsgUniqueId(target.chatType, this.nextMsgTime());
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

    /** 按 msgId 批量拉取消息（get_msg / 精华消息 / ptt 转文字共用）。 */
    async fetchMsgsByMsgId(target: Peer, ids: string[]): Promise<RawMessage[]> {
        if (ids.length === 0) {
            return [];
        }
        const raw = await this.service.getMsgsByMsgId(target, ids);
        unwrapResult("getMsgsByMsgId", raw);
        return raw.msgList ?? [];
    }

    /** 消息表情表态（set_msg_emoji_like；like=true 点赞，false 取消）。 */
    async setMsgEmojiLike(
        target: Peer,
        opts: { msgSeq: string; emojiId: string; emojiType: string; like: boolean },
    ): Promise<void> {
        const raw = await this.service.setMsgEmojiLikes(
            target,
            opts.msgSeq,
            opts.emojiId,
            opts.emojiType,
            opts.like,
        );
        unwrapResult("setMsgEmojiLikes", raw);
    }

    /**
     * 语音转文字（fetch_ptt_text）。
     * 流程：按 msgId 拉消息 → 找 PTT 元素 → translatePtt2Text（异步转写）
     * → 再拉一次消息读 pttElement.text。
     */
    async fetchPttText(msgId: string, target: Peer): Promise<string> {
        const msgs = await this.fetchMsgsByMsgId(target, [msgId]);
        const [first] = msgs;
        if (first === undefined) {
            throw kernelError("消息不存在", "NOT_FOUND");
        }
        const ptt = first.elements.find((el) => el.pttElement !== undefined);
        if (ptt?.pttElement === undefined) {
            throw kernelError("消息中不包含语音", "NOT_FOUND");
        }
        const raw = await this.service.translatePtt2Text(msgId, target, ptt);
        unwrapResult("translatePtt2Text", raw);
        // 转写异步完成：再拉一次拿 text
        const after = await this.fetchMsgsByMsgId(target, [msgId]);
        const [afterFirst] = after;
        if (afterFirst === undefined) {
            throw kernelError("获取语音转文字结果失败", "UNKNOWN");
        }
        const text = afterFirst.elements.find((el) => el.pttElement !== undefined)?.pttElement
            ?.text;
        if (text === undefined || text === "") {
            throw kernelError("获取语音转文字结果失败", "UNKNOWN");
        }
        return text;
    }

    /** 标记会话已读。 */
    async markRead(target: Peer): Promise<void> {
        const raw = await this.service.setMsgRead(target);
        unwrapResult("setMsgRead", raw);
    }

    /** 发送输入状态（set_input_status；eventType=1 输入中，0 停止）。 */
    async setInputStatus(target: Peer, eventType: number): Promise<void> {
        await this.service.sendShowInputStatusReq(target.chatType, eventType, target.peerUid);
    }

    /**
     * 发送合并转发（send_group/private_forward_msg）。
     * buildMultiForwardMsg 组装 MULTI_FORWARD 元素 → 直接作 sendMsg 元素发送。
     */
    async sendForwardMessage(
        target: Peer,
        sourcePeer: Peer,
        srcMsgIds: string[],
    ): Promise<{ msgId: string }> {
        if (srcMsgIds.length === 0) {
            throw kernelError("sendForwardMessage 需要至少一条源消息", "INVALID_PARAM");
        }
        const built = await this.service.buildMultiForwardMsg({
            srcMsgIds,
            srcContact: sourcePeer,
        });
        unwrapResult("buildMultiForwardMsg", built);
        const elements = built.rspInfo?.elements;
        if (elements === undefined || elements.length === 0) {
            throw kernelError("合并转发组装失败：无元素", "UNKNOWN");
        }
        const msgId = this.service.generateMsgUniqueId(target.chatType, String(Date.now()));
        const raw = await this.service.sendMsg(msgId, target, elements, new Map());
        unwrapResult("sendMsg", raw);
        return { msgId };
    }

    /** 获取合并转发内容（get_forward_msg；resId 取自 multiForwardMsgElement）。 */
    async fetchForwardMessage(peer: Peer, msgId: string): Promise<RawMessage[]> {
        const msgs = await this.fetchMsgsByMsgId(peer, [msgId]);
        const [first] = msgs;
        if (first === undefined) {
            throw kernelError("消息不存在", "NOT_FOUND");
        }
        const forward = first.elements.find(
            (el) => el.multiForwardMsgElement !== undefined,
        )?.multiForwardMsgElement;
        if (forward === undefined || forward.resId === "") {
            throw kernelError("消息不包含合并转发内容", "NOT_FOUND");
        }
        const raw = await this.service.getMultiMsg(peer, msgId, forward.resId);
        unwrapResult("getMultiMsg", raw);
        return raw.msgList ?? [];
    }

    /** 单条转发（forward_group/friend_single_msg；srcMsgIds 源、dstPeer 目标）。 */
    async forwardSingleMessage(
        sourcePeer: Peer,
        srcMsgIds: string[],
        dstPeer: Peer,
    ): Promise<void> {
        if (srcMsgIds.length === 0) {
            throw kernelError("forwardSingleMessage 需要至少一条源消息", "INVALID_PARAM");
        }
        const raw = await this.service.forwardMsg(srcMsgIds, sourcePeer, [dstPeer], undefined);
        unwrapResult("forwardMsg", raw);
    }

    /** 设置在线状态（set_online_status；customStatus 为自定义状态）。 */
    async setOnlineStatus(opts: {
        status: number;
        extStatus: number;
        batteryStatus: number;
        customStatus?: { faceId: string; wording: string; faceType: string };
    }): Promise<void> {
        const raw = await this.service.setStatus(opts);
        unwrapResult("setStatus", raw);
    }
}
