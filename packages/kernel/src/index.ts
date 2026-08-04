/**
 * @napuketto/kernel 入口（P0 地基）
 *
 * 当前导出：类型化错误（ADR-017）、路径装配（ADR-016）、pino 日志（ADR-007）、
 * JSON 配置基类（ADR-012）、类型化事件通道（ADR-003）。
 * 后续模块（wrapper-loader / apis / cache / login）按 docs/design.md §9 依次接入。
 */

export type { ConfigOptions, ConfigSchema } from "./config.js";
export { ConfigBase } from "./config.js";
export type { KernelErrorCode } from "./errors.js";
export { isKernelError, KERNEL_ERROR_CODES, KernelError, kernelError } from "./errors.js";
export type { ListenerEvents } from "./event-channel.js";
export { NTEventChannel } from "./event-channel.js";
export type { LoggerOptions, LogLevel } from "./logger.js";
export { createLogger } from "./logger.js";
export type { PathOptions } from "./paths.js";
export { DEFAULT_DATA_ROOT_NAME, PathWrapper, resolveDataRoot } from "./paths.js";
export type { RawMessage } from "./types/entities.js";
export type { MsgListener } from "./types/listeners/msg.js";
export type { CanonicalElement } from "./types/message-element.js";
export { toCanonicalElements, toSendElements } from "./types/message-element.js";
