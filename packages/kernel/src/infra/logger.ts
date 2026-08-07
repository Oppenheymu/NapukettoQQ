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
