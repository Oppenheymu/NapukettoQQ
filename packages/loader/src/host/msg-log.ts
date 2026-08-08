/**
 * 控制台消息日志（从 protocols.ts 拆分，2026-08-08 FTA 优化）
 *
 * 收到消息打印到控制台（NapCat 同款）。独立订阅，不干扰 adapter 的 OB11 翻译广播；
 * 解析纯函数无副作用（ADR-008）。高频业务日志调用点直接传**纯字符串**（不传对象），
 * pino-pretty 天然单行渲染，避免对象属性多行展开刷屏；boot 文件日志保留（引导期诊断）。
 *
 * 格式（2026-08-07 用户定稿）：`loader | 接收 <- 群聊 [群124010257] [用户3054108135]： 内容`
 *  - 剥离群名/用户名，只保留 ID（横向精简）：群聊显示 [群uin] + [用户uin]，
 *    私聊只显示 [用户对端uin]（会话即用户，避免重复）
 *  - 前缀灰色（背景噪音）、群 ID 青色、用户 ID 绿色、内容默认色（视觉焦点）
 *  - 内容内换行补 4 空格缩进，避免多行文本顶格破坏队形
 *  - console 版带 ANSI（logger），boot 文件版纯文本（log），互不污染
 */
import type { CanonicalElementLike, EventChannelLike, KernelLike, LoggerLike } from "./types.js";
import { errMsg, log } from "./util.js";

/** 终端 ANSI 颜色（消息日志颜色分层，2026-08-07 用户定稿）。 */
const ANSI = {
    gray: "\u001b[90m",
    cyan: "\u001b[36m",
    green: "\u001b[32m",
    reset: "\u001b[0m",
} as const;

/** canonical 元素 → 日志占位文本。 */
function elementToText(el: CanonicalElementLike): string {
    if (el.type === "text") {
        return el.text ?? "";
    }
    if (el.type === "at") {
        return `@${el.display ?? (el.target === "all" ? "全体" : el.target)}`;
    }
    if (el.type === "file") {
        return `[文件${el.name ?? ""}]`;
    }
    if (el.type === "forward") {
        return "[合并转发]";
    }
    return `[${el.type}]`;
}

/** 渲染消息为单行文本（text 拼接，at/媒体元素转占位）。 */
function renderMessage(kernel: KernelLike, msg: unknown): string {
    let rendered = "";
    for (const el of kernel.toCanonicalElements(msg)) {
        rendered += elementToText(el);
    }
    return rendered === "" ? "[空消息/媒体]" : rendered;
}

/**
 * 消息日志订阅（onRecvMsg 回调参数为消息数组——2026-08-07 运行时实证，遍历逐条打印）。
 */
export function setupMsgLogging(
    kernel: KernelLike,
    channel: EventChannelLike,
    logger: LoggerLike | undefined,
): void {
    channel.on("Msg/onRecvMsg", (msgs) => {
        const list = Array.isArray(msgs) ? msgs : [msgs];
        for (const msg of list) {
            if (!msg || typeof msg !== "object") {
                continue;
            }
            try {
                const raw = msg as { chatType?: unknown; peerUin?: unknown; senderUin?: unknown };
                const rendered = renderMessage(kernel, msg);
                const isGroup = raw.chatType === kernel.ChatType.GROUP;
                const kind = isGroup ? "群聊" : "私聊";
                const peerUin = String(raw.peerUin ?? "");
                const senderUin = String(raw.senderUin ?? (peerUin || "未知"));
                // 群聊：群 + 用户两个标签；私聊：会话即用户，只显示用户标签
                const plainTags = isGroup
                    ? `[群${peerUin}] [用户${senderUin}]`
                    : `[用户${senderUin}]`;
                const coloredTags = isGroup
                    ? `${ANSI.cyan}[群${peerUin}]${ANSI.reset} ${ANSI.green}[用户${senderUin}]${ANSI.reset}`
                    : `${ANSI.green}[用户${senderUin}]${ANSI.reset}`;
                // 内容内换行补缩进（4 空格），长文本/多行消息换行后不顶格
                const content = rendered.replace(/\n/g, "\n    ");
                const plain = `接收 <- ${kind} ${plainTags}： ${content}`;
                const colored =
                    `${ANSI.gray}loader | 接收 <- ${kind}${ANSI.reset} ` +
                    `${coloredTags}： ${content}`;
                log(plain);
                logger?.info(colored);
            } catch (e) {
                const line2 = `接收消息（解析失败: ${errMsg(e)}）`;
                log(line2);
                logger?.warn(line2);
            }
        }
    });
}
