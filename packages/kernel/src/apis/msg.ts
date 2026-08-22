/**
 * MsgApi：消息语义化 API（ADR-009 统一错误语义）
 *
 * 内部解包原生 `{ result, errMsg }`：成功返回纯业务值，失败抛 KernelError。
 * 协议层只维护 `KernelErrorCode → 协议错误码` 映射表，不解析错误逻辑。
 *
 * 方法面（P2-1）：发送 / 撤回 / 拉历史 / 标记已读。group/friend 等后续 apis 同构。
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { MsgEventChannel } from "../bridge/msg-bridge.js";
import { kernelError } from "../infra/index.js";
import type {
    CanonicalElement,
    NodeIKernelMsgService,
    NodeIQQNTWrapperSession,
    Peer,
    RawElement,
    RawMessage,
    SendMessageElement,
} from "../types/index.js";
import { ElementType, toSendElements } from "../types/index.js";
import { unwrapResult } from "./result.js";

/** 发送状态（onMsgInfoListUpdate 事件 msg.sendStatus）。 */
const SEND_STATUS = { FAILED: 0, SENDING: 1, SUCCESS: 2, SUCCESS_NO_SEQ: 3 } as const;

/** 发送确认超时（毫秒）。 */
const SEND_CONFIRM_TIMEOUT_MS = 15_000;

/**
 * PIC 元素发送契约值（NapCat 同款发送契约值，未逐字段校准）。
 * 下列固定值均为实测调通的 wrapper 发送契约（picType / picSubType /
 * picWidth / picHeight / original / thumbFileSize），只抽常量不改值——改值会破坏图片发送。
 */
const PIC_TYPE = 1000;
const PIC_SUB_TYPE = 0;
const PIC_WIDTH = 0;
const PIC_HEIGHT = 0;
const PIC_ORIGINAL = true;
const PIC_THUMB_FILE_SIZE = 0;

/**
 * PTT 元素发送契约值（NapCat 同款发送契约值，未逐字段校准）。
 * silk v3 协议：下列固定值均为实测调通的 wrapper 发送契约（formatType / voiceType /
 * voiceChangeType / canConvert2Text / playState / autoConvertText / storeID /
 * otherBusinessInfo.aiVoiceType），只抽常量不改值——改值会破坏语音发送。
 */
const PTT_FORMAT_TYPE = 1;
const PTT_VOICE_TYPE = 1;
const PTT_VOICE_CHANGE_TYPE = 0;
const PTT_CAN_CONVERT_2_TEXT = true;
const PTT_PLAY_STATE = 1;
const PTT_AUTO_CONVERT_TEXT = 0;
const PTT_STORE_ID = 0;
const PTT_AI_VOICE_TYPE = 0;
/** 假波形数组（占位波形）：无真实振幅数据时发送的固定占位，silk v3 协议契约值。 */
const PTT_WAVE_AMPLITUDES = [0, 18, 9, 23, 16, 17, 16, 15, 44, 17, 24, 20, 14, 15, 17];

/** 读文件 stat（富媒体发送预处理；文件不存在抛 INVALID_PARAM）。 */
async function statFile(path: string): Promise<{ size: number }> {
    try {
        return await stat(path);
    } catch {
        throw kernelError(`图片文件不存在: ${path}`, "INVALID_PARAM");
    }
}

/** 计算文件 md5（十六进制小写）。 */
async function hashFile(path: string): Promise<string> {
    try {
        const buf = await readFile(path);
        return createHash("md5").update(buf).digest("hex");
    } catch {
        throw kernelError(`图片文件读取失败: ${path}`, "INVALID_PARAM");
    }
}

/**
 * 清洗撤回消息 id（防御外部脏参数）。
 *
 * 调用方（IPC / 协议层 / koishi 适配器）可能传 null、非数组、空字符串等——
 * 直接透传会让裸 TypeError 逃逸，或把脏值一路送到 wrapper.node 才失败
 * （原生层只回「无错误详情」，排查困难）。规则：
 *  - 非数组 → INVALID_PARAM
 *  - 过滤空字符串 / 纯空白 / 非字符串
 *  - 清洗后为空 → INVALID_PARAM
 */
function sanitizeRecallMsgIds(msgIds: string[]): string[] {
    if (!Array.isArray(msgIds)) {
        throw kernelError("recallMessage 的 msgIds 必须是数组", "INVALID_PARAM");
    }
    const ids = msgIds.filter((id) => typeof id === "string" && id.trim() !== "");
    if (ids.length === 0) {
        throw kernelError("recallMessage 需要至少一个非空 msgId", "INVALID_PARAM");
    }
    return ids;
}

/** 消息 API：从 session 拿 msg service，包装成语义化方法。 */
export class MsgApi {
    private readonly service: NodeIKernelMsgService;
    /** 消息事件通道（sendMsg 后等 onMsgInfoListUpdate 确认发送结果）。 */
    private readonly channel: MsgEventChannel | null;
    /** NodeQQNTWrapperUtil（富媒体发送 copyFile 用；session 拿不到时可为 null）。 */
    private readonly util: { get(): unknown } | null;
    /** 上次生成 msgId 的时间（单调递增，2026-08-07 防同毫秒并发碰撞）。 */
    private lastMsgTime = 0;

    constructor(session: NodeIQQNTWrapperSession, channel?: MsgEventChannel, util?: unknown) {
        const service = session.getMsgService() as unknown as NodeIKernelMsgService | null;
        if (service === null || service === undefined) {
            throw kernelError("getMsgService() 返回空（session 未 init）", "INVALID_STATE");
        }
        this.service = service;
        this.channel = channel ?? null;
        // util 传入形态：构造器（NodeQQNTWrapperUtil，含 get()）或实例，宽松兼容
        this.util = util !== null && util !== undefined ? (util as { get(): unknown }) : null;
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
        // NapCat 式富媒体预处理：PIC 元素补 md5/fileName/sourcePath 并放置文件
        // （getRichMediaFilePathForGuild → util.copyFile），否则发送器走未初始化
        // 的 FlashFileUploadService 导致 rich media transfer failed。
        const sendElements = await this.prepareSendElements(elements);
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
        // ⚠️ 预消费 confirm 的 rejection（2026-08-22 崩溃根因修复）：若下方
        // service.sendMsg 抛错（wrapper 内部异常），confirm 确认监听已注册却无人
        // await，事件回调里 reject 会变成 unhandledRejection，Node 默认抛错退出
        // 直接拖垮整个子进程（实测：sendStatus=0 确认事件触发后进程崩溃、IPC
        // 通道关闭）。先挂 no-op 消费兜底，`await confirm` 仍能正常收到结果
        // （Promise 允许多个消费者），失败语义不变。
        confirm.catch(() => undefined);
        await this.service.sendMsg("0", sendPeer, sendElements, new Map());
        await confirm;
        return { msgId };
    }

    /**
     * canonical 元素 → 发送元素，富媒体（PIC/PTT）做 NapCat 式预处理。
     * 2026-08-11 修复（实测）：图片发送必须 elementType=2（PIC）+ 完整 picElement
     * （md5HexStr/fileSize/fileName/sourcePath），且文件须经 getRichMediaFilePathForGuild
     * 计算目标路径 + util.copyFile 放置——缺任一环节 sendMsg 返回 rich media transfer failed。
     * 2026-08-12（语音）：PTT 同理——只给 filePath 触发 wrapper 内部
     * "Cannot convert undefined or null to object"（缺字段转换失败）。
     */
    private async prepareSendElements(elements: CanonicalElement[]): Promise<SendMessageElement[]> {
        const out: SendMessageElement[] = [];
        for (const el of elements) {
            switch (el.type) {
                case "image":
                    out.push(await this.prepareImageElement(el.path));
                    break;
                case "voice":
                    out.push(await this.preparePttElement(el.path));
                    break;
                default:
                    out.push(...toSendElements([el]));
                    break;
            }
        }
        return out;
    }

    /** PIC 元素 NapCat 式预处理：md5 → 目标路径 → copyFile → 完整 picElement。 */
    private async prepareImageElement(path: string): Promise<SendMessageElement> {
        const file = await statFile(path);
        const md5 = await hashFile(path);
        const fileName = basename(path);
        const relPath = await this.placeMediaFile(path, ElementType.PIC, md5, fileName);
        return {
            elementType: ElementType.PIC,
            elementId: "",
            picElement: {
                md5HexStr: md5,
                fileSize: String(file.size),
                picWidth: PIC_WIDTH,
                picHeight: PIC_HEIGHT,
                fileName,
                sourcePath: relPath,
                original: PIC_ORIGINAL,
                picType: PIC_TYPE,
                picSubType: PIC_SUB_TYPE,
                fileUuid: "",
                fileSubId: "",
                thumbFileSize: PIC_THUMB_FILE_SIZE,
                summary: "",
            },
        };
    }

    /**
     * PTT 元素 NapCat 式预处理：md5 → 目标路径 → copyFile → 完整 pttElement。
     *
     * 2026-08-12（实测依据）：只给 filePath 时 wrapper 内部抛
     * "Cannot convert undefined or null to object"（缺 md5HexStr/fileSize 等字段），
     * 且发送后进程崩溃重启（supervisor 自动拉起）。完整字段（NapCat 同款，
     * formatType/voiceType/canConvert2Text/waveAmplitudes 等）消除该错误。
     *
     * ⚠️ silk 格式：QQ 语音协议为 silk v3。非 silk → silk 的转码在协议层
     * （adapter，@napuketto/media 的 encodePcmToSilk，2026-08-12 接线）完成，
     * 此处接收的已是 silk 路径，仅做放置。kernel 不 import media（解耦红线）。
     */
    private async preparePttElement(path: string): Promise<SendMessageElement> {
        const file = await statFile(path);
        const md5 = await hashFile(path);
        const fileName = basename(path);
        const relPath = await this.placeMediaFile(path, ElementType.PTT, md5, fileName);
        // 时长估算（NapCat 同款规则：~3KB/s 语音码率，缺 ffprobe 时兜底）
        const duration = Math.max(1, Math.floor(file.size / 1024 / 3));
        return {
            elementType: ElementType.PTT,
            elementId: "",
            pttElement: {
                fileName,
                filePath: relPath,
                md5HexStr: md5,
                fileSize: String(file.size),
                duration,
                formatType: PTT_FORMAT_TYPE,
                voiceType: PTT_VOICE_TYPE,
                voiceChangeType: PTT_VOICE_CHANGE_TYPE,
                canConvert2Text: PTT_CAN_CONVERT_2_TEXT,
                waveAmplitudes: PTT_WAVE_AMPLITUDES,
                fileSubId: "",
                playState: PTT_PLAY_STATE,
                autoConvertText: PTT_AUTO_CONVERT_TEXT,
                storeID: PTT_STORE_ID,
                otherBusinessInfo: { aiVoiceType: PTT_AI_VOICE_TYPE },
            },
        };
    }

    /**
     * 富媒体文件放置（PIC/PTT 共用）：md5 + 文件名 → QQ 内部目标路径
     * （getRichMediaFilePathForGuild）→ util.copyFile 放置 → 返回相对数据根路径。
     */
    private async placeMediaFile(
        path: string,
        elementType: ElementType,
        md5: string,
        fileName: string,
    ): Promise<string> {
        const service = this.service;
        const util = this.util;
        // getRichMediaFilePathForGuild：QQ 内部目标路径（纯文件名，相对数据根）。
        // 固定入参 elementSubType / thumbSize / downloadType 为 NapCat 同款发送契约值
        // （未逐字段校准），发送方向固定，改值会破坏富媒体路径计算。
        const relPath = service.getRichMediaFilePathForGuild({
            md5HexStr: md5,
            fileName,
            elementType,
            elementSubType: 0, // 元素子类型（发送固定 0）
            thumbSize: 0, // 缩略图尺寸（发送固定 0，不预生成缩略图）
            needCreate: true,
            downloadType: 1, // 下载类型（发送固定 1）
            file_uuid: "",
        });
        if (util !== null) {
            const instance = typeof util.get === "function" ? util.get() : util;
            const copy = (instance as Record<string, unknown>)["copyFile"];
            if (typeof copy === "function") {
                await (copy as (a: string, b: string) => Promise<unknown>).call(
                    instance,
                    path,
                    relPath,
                );
            }
        }
        return relPath;
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
        const raw = await this.service.recallMsg(target, sanitizeRecallMsgIds(msgIds));
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
