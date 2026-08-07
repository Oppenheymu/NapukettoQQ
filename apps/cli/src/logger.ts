/**
 * cli 进程级 logger（ADR-007 日志规范，2026-08-07 统一改造）。
 *
 * 复用 kernel `createLogger`（console pretty + redact，格式与 kernel 子进程完全一致：
 * `[时间] LEVEL (name/pid): 消息` + 缩进元数据）。只打 console 不写文件——文件日志由
 * kernel 装配（NapukettoCore.create → `<数据根>/logs/napuketto.log`）负责。
 *
 * 无全局单例（ADR-015 推论）：cli 每进程一份，模块级单例即可；`base.name` 用 pino
 * 保留字段 name（logger name）标注来源——pino-pretty 自动渲染为 `(cli/pid)` 元数据头，
 * 不占额外属性行，文件/JSON 侧仍保留 name 字段可过滤。
 *
 * 级别：`NAPKETTO_LOG_LEVEL` 环境变量可覆盖（缺省 info，非法值忽略）。
 */
import process from "node:process";
import { createLogger, type LogLevel } from "@napuketto/kernel";

/** 合法级别集合（pino 标准级别）。 */
const LOG_LEVELS: readonly LogLevel[] = [
    "trace",
    "debug",
    "info",
    "warn",
    "error",
    "fatal",
    "silent",
];

/** 解析日志级别（env 覆盖，非法/缺失回退 info）。 */
function resolveLevel(): LogLevel {
    const raw = process.env["NAPKETTO_LOG_LEVEL"];
    if (raw !== undefined && (LOG_LEVELS as readonly string[]).includes(raw)) {
        return raw as LogLevel;
    }
    return "info";
}

/**
 * 窄接口注解（避免 TS2883：createLogger 返回 pino.Logger，cli 不直接依赖 pino，
 * declaration emit 无法命名该类型；pino.Logger 结构兼容本接口）。
 */
export interface CliLogger {
    info(obj: unknown, msg?: string): void;
    warn(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
    debug(obj: unknown, msg?: string): void;
    trace(obj: unknown, msg?: string): void;
    fatal(obj: unknown, msg?: string): void;
}

/** cli 进程日志（name 渲染为 (cli/pid) 元数据头，文件 JSON 保留 name 字段可过滤）。 */
export const logger: CliLogger = createLogger({
    level: resolveLevel(),
    console: true,
    base: { service: "cli" },
});
