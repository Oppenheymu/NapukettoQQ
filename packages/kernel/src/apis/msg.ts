/**
 * MsgApi：消息语义化 API（ADR-009 统一错误语义）
 *
 * 内部解包原生 `{ result, errMsg }`：成功返回纯业务值，失败抛 KernelError。
 * 协议层只维护 `KernelErrorCode → 协议错误码` 映射表，不解析错误逻辑。
 *
 * 方法面（P2-1）：发送 / 撤回 / 拉历史 / 标记已读。group/friend 等后续 apis 同构。
 */
import type { MsgEventChannel } from "../bridge/msg-bridge.js";
import { kernelError } from "../infra/index.js";
import type {
    CanonicalElement,
    NodeIKernelMsgService,
    NodeIQQNTWrapperSession,
    Peer,
    RawElement,
    RawMessage,
} from "../types/index.js";
import { toSendElements } from "../types/index.js";
import { unwrapResult } from "./result.js";

/** 发送状态（onMsgInfoListUpdate 事件 msg.sendStatus）。 */
const SEND_STATUS = { FAILED: 0, SENDING: 1, SUCCESS: 2, SUCCESS_NO_SEQ: 3 } as const;

/** 发送确认超时（毫秒）。 */
const SEND_CONFIRM_TIMEOUT_MS = 15_000;

/** 消息 API：从 session 拿 msg service，包装成语义化方法。 */
export class MsgApi {
    private readonly service: NodeIKernelMsgService;
    /** 消息事件通道（sendMsg 后等 onMsgInfoListUpdate 确认发送结果）。 */
    private readonly channel: MsgEventChannel | null;
    /** 上次生成 msgId 的时间（单调递增，2026-08-07 防同毫秒并发碰撞）。 */
    private lastMsgTime = 0;

    constructor(session: NodeIQQNTWrapperSession, channel?: MsgEventChannel) {
        const service = session.getMsgService() as unknown as NodeIKernelMsgService | null;
        if (service === null || service === undefined) {
            throw kernelError("getMsgService() 返回空（session 未 init）", "INVALID_STATE");
        }
        this.service = service;
        this.channel = channel ?? null;
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
     * 发送消息：canonical 元素 → NT 发送元素 → sendMsg（NapCat 式）。
     * 返回 NT msgId（雪花 ID）。
     *
     * 2026-08-11 修复（NapCat 式，实测）：
     *  - sendMsg 第一参传 '0'（固定），msgId 塞 peer.guildId —— 传 msgId 作第一参
     *    时 wrapper 返回 result=5（失败），NapCat 同款调用返回 result=0。
     *  - 发送结果以 onMsgInfoListUpdate 事件确认（sendStatus===2 成功）：sendMsg
     *    返回值 result 可能为 5 但事件仍成功（异步确认），反之亦然。
     *  - ⚠️ 必须先注册事件监听再调 sendMsg（事件可能在 sendMsg 返回前就触发）。
     */
    async sendMessage(target: Peer, elements: CanonicalElement[]): Promise<{ msgId: string }> {
        const sendElements = toSendElements(elements);
        const msgId = this.service.generateMsgUniqueId(target.chatType, this.nextMsgTime());
        // NapCat 同款：msgId 塞 guildId，第一参 '0'
        const sendPeer: Peer = { ...target, guildId: msgId };
        // 无事件通道（老用法）：退化为看返回值
        if (this.channel === null) {
            const raw = await this.service.sendMsg("0", sendPeer, sendElements, new Map());
            unwrapResult("sendMsg", raw);
            return { msgId };
        }
        // 有事件通道：先注册确认监听（NapCat 式，事件可能早于 sendMsg 返回触发），
        // 再调 sendMsg。最终结果以事件 sendStatus 为准（raw.result 非 0 不判失败）。
        const confirm = this.confirmSend(msgId, target);
        await this.service.sendMsg("0", sendPeer, sendElements, new Map());
        await confirm;
        return { msgId };
    }

    /** 注册 onMsgInfoListUpdate 确认监听（返回 Promise，resolve 时发送成功）。 */
    private confirmSend(msgId: string, target: Peer): Promise<void> {
        const channel = this.channel;
        if (channel === null) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const off = channel.on("Msg/onMsgInfoListUpdate", (list) => {
                const mine = list.find((m) => m.guildId === msgId);
                if (mine === undefined) {
                    return; // 不是本次消息
                }
                if (
                    mine.sendStatus === SEND_STATUS.SUCCESS ||
                    mine.sendStatus === SEND_STATUS.SUCCESS_NO_SEQ
                ) {
                    off();
                    resolve();
                } else if (mine.sendStatus === SEND_STATUS.FAILED) {
                    off();
                    reject(
                        kernelError(`sendMsg 失败: sendStatus=${mine.sendStatus}`, "SEND_FAILED"),
                    );
                }
                // SENDING：继续等
            });
            // 超时兜底
            setTimeout(() => {
                off();
                reject(
                    kernelError(
                        `sendMsg 等待确认超时（msgId=${msgId}, target=${JSON.stringify(target)}）`,
                        "SEND_FAILED",
                    ),
                );
            }, SEND_CONFIRM_TIMEOUT_MS);
        });
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
        const ptt = findPttElement(msgs);
        if (ptt === null) {
            throw kernelError("消息中不包含语音", "NOT_FOUND");
        }
        const raw = await this.service.translatePtt2Text(msgId, target, ptt);
        unwrapResult("translatePtt2Text", raw);
        // 转写异步完成：再拉一次拿 text
        const after = await this.fetchMsgsByMsgId(target, [msgId]);
        const text = findPttElement(after)?.pttElement?.text;
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
        const forward = findForwardElement(msgs);
        if (forward === null || forward.resId === "") {
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

/** 在消息列表中找含 pttElement 的元素（找不到返回 null）。 */
function findPttElement(msgs: RawMessage[]): RawElement | null {
    const [first] = msgs;
    if (first === undefined) {
        return null;
    }
    return first.elements.find((el) => el.pttElement !== undefined) ?? null;
}

/** 在消息列表中找含 multiForwardMsgElement 的元素（找不到返回 null）。 */
function findForwardElement(
    msgs: RawMessage[],
): { resId: string; fileName: string; xmlContent: string } | null {
    const [first] = msgs;
    if (first === undefined) {
        return null;
    }
    return (
        first.elements.find((el) => el.multiForwardMsgElement !== undefined)
            ?.multiForwardMsgElement ?? null
    );
}
