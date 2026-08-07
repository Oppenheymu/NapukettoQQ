/**
 * pino 日志封装（ADR-007）
 *
 * - console（pino-pretty 可读输出）+ 可选文件双目的地
 * - 统一 level 控制
 * - 内置 redact（token / 票据等敏感字段不打日志），可追加
 * - 无全局单例（ADR-015 推论）：每进程实例化一份，由装配层持有
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";
import pino from "pino";
import pinoPretty from "pino-pretty";
import { KernelError } from "./errors.js";

/** 默认 redact 路径：顶层 token/票据 + 任意深度的密码/密钥。 */
const DEFAULT_REDACT_PATHS = ["token", "ticket", "cookie", "password", "secret"] as const;

/** 保持多行展开的系统配置日志消息（其余带属性日志压缩单行，2026-08-07 统一风格）。 */
const MULTILINE_MESSAGES = new Set(["QQ 安装信息", "数据目录", "loginService.initConfig OK"]);

/** pino 元键 + 已内联键（不参与属性展示；err/error 留给 prettifyError 展示堆栈）。 */
const META_KEYS = new Set(["time", "pid", "hostname", "level", "v", "service", "err", "error"]);

/** 从日志对象删除已消费的自定义键（否则 prettifyObject 会二次打印）。 */
function dropKeys(log: Record<string, unknown>, keys: Iterable<string>): void {
    for (const key of keys) {
        delete log[key];
    }
}

/** 值显示（对齐 pino-pretty：字符串带引号、还原 JSON.stringify 的反斜杠转义）。 */
function formatValue(value: unknown): string {
    const raw = JSON.stringify(value);
    return raw === undefined ? "undefined" : raw.replace(/\\\\/gi, "\\");
}

/**
 * pino-pretty messageFormat（2026-08-07 统一日志风格，cli/kernel/loader 全链路一致）：
 *   1. 业务消息日志（`收到消息` / 带 `text` 字段）→ 单行流 `(service): [群聊] 发送者: 内容`（防刷屏）
 *   2. 特定系统配置日志（MULTILINE_MESSAGES）→ 多行展开（每字段一行，4 空格缩进）
 *   3. 其他带属性日志 → 压缩单行 `(service): 消息 -> k: v | k2: v2`
 *   4. 纯文本日志 → `(service): 消息`
 *
 * 消费过的自定义键会从 log 删除（pino-pretty 的 prettifyObject 会打印剩余自定义字段，
 * 不删会双倍输出）；`err`/`error` 键保留，交给 prettifyError 展示完整堆栈。
 */
export function formatLogMessage(log: Record<string, unknown>, messageKey: string): string {
    const msg = log[messageKey];
    const message = typeof msg === "string" ? msg : "";
    const service = typeof log["service"] === "string" ? `(${log["service"]})` : "";
    // service 已内联进消息前缀，删除避免 prettifyObject 二次打印
    delete log["service"];
    const prefix = service === "" ? "" : `${service}: `;

    // 1. 业务消息日志：强制单行流（防刷屏）
    if (message === "收到消息" || log["text"] !== undefined) {
        const kind = typeof log["kind"] === "string" ? log["kind"] : "消息";
        const senderRaw = typeof log["sender"] === "string" ? log["sender"] : undefined;
        const peerRaw = typeof log["peer"] === "string" ? log["peer"] : undefined;
        const sender = senderRaw ?? peerRaw ?? "未知";
        const content = log["text"] === "" ? "[空消息/媒体]" : String(log["text"] ?? "");
        dropKeys(log, ["text", "kind", "sender", "peer", "peerUin"]);
        return `${prefix}[${kind}] ${sender}: ${content}`;
    }

    // 提取除核心字段外的所有自定义属性
    const extraKeys = Object.keys(log).filter((k) => !META_KEYS.has(k) && k !== messageKey);

    // 2. 特定的系统配置日志：保持多行展开
    if (extraKeys.length > 0 && MULTILINE_MESSAGES.has(message)) {
        const lines = extraKeys.map((k) => `    ${k}: ${formatValue(log[k])}`);
        dropKeys(log, extraKeys);
        return `${prefix}${message}\n${lines.join("\n")}`;
    }

    // 3. 其他普通带属性的日志：压缩成单行
    if (extraKeys.length > 0) {
        const details = extraKeys.map((k) => `${k}: ${formatValue(log[k])}`).join(" | ");
        dropKeys(log, extraKeys);
        return `${prefix}${message} -> ${details}`;
    }

    // 4. 纯文本日志
    return `${prefix}${message}`;
}

function toSingle(streams: Array<{ stream: pino.DestinationStream }>): pino.DestinationStream {
    const [only] = streams;
    if (only === undefined) {
        // 不可达：调用方已保证 streams 非空
        throw new KernelError("logger 内部错误：目的地列表为空", "UNKNOWN");
    }
    return only.stream;
}

/** 日志级别（pino 标准级别 + silent）。 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";

export interface LoggerOptions {
    /** 日志级别，默认 `info`。 */
    level?: LogLevel;
    /** 是否输出到 console（pretty 模式），默认 true。 */
    console?: boolean;
    /** 文件日志路径；不传则不写文件（父目录自动创建）。 */
    file?: string;
    /** 附加基础字段（如 `{ service: 'kernel' }`），自动保留 pid。 */
    base?: Record<string, unknown>;
    /** 追加的敏感字段路径（默认内置 token/票据等，见 DEFAULT_REDACT_PATHS）。 */
    redact?: string[];
}

/**
 * 创建 pino logger：console（pretty）+ 可选文件，统一 level / redact。
 *
 * 文件目的地用同步写入（`sync: true`）：日志量级下性能可接受，且进程退出不丢日志，
 * 无需额外的 flush 步骤（对比异步 SonicBoom 的 flushSync 时序陷阱）。
 */
export function createLogger(opts: LoggerOptions = {}): pino.Logger {
    const level = opts.level ?? "info";
    const consoleEnabled = opts.console ?? true;
    const { file, base } = opts;

    const streams: Array<{ stream: pino.DestinationStream }> = [];
    if (consoleEnabled) {
        streams.push({
            stream: pinoPretty({
                colorize: true,
                translateTime: "SYS:standard",
                // messageFormat：统一日志风格（单行流/多行展开/压缩单行/纯文本）
                messageFormat: formatLogMessage,
                // ⚠️ 必须显式传 destination=process.stdout：pino-pretty 默认用
                // sonic-boom 直写 fd 1（UTF-8 字节流），在 pnpm start（cmd.exe +
                // 管道 936 转码）链路下中文被按 GBK 解码成乱码、ANSI 残留；
                // 走 process.stdout 的 TTY 路径（WriteConsoleW UTF-16）编码正确。
                destination: process.stdout,
            }),
        });
    }
    if (file) {
        mkdirSync(dirname(file), { recursive: true });
        streams.push({ stream: pino.destination({ dest: file, sync: true }) });
    }
    if (streams.length === 0) {
        throw new KernelError("logger 至少需要一个输出目标：console 或 file", "INVALID_PARAM");
    }

    const pinoOptions: pino.LoggerOptions = {
        level,
        redact: [...DEFAULT_REDACT_PATHS, ...(opts.redact ?? [])],
    };
    if (base) {
        pinoOptions.base = { pid: process.pid, ...base };
    }

    let stream: pino.DestinationStream | ReturnType<typeof pino.multistream>;
    if (streams.length === 1) {
        stream = toSingle(streams);
    } else {
        stream = pino.multistream(streams);
    }

    return pino(pinoOptions, stream);
}
