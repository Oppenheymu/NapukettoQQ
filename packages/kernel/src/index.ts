/**
 * @napuketto/kernel 入口（P0 地基 + P1 前哨）
 *
 * 当前导出：类型化错误（ADR-017）、路径装配（ADR-016）、pino 日志（ADR-007）、
 * JSON 配置基类（ADR-012）、类型化事件通道（ADR-003）、QQ 版本探测（ADR-018）、
 * wrapper NAPI 引导（P1，2026-08-05 重构：loader 截获 exports 后初始化，无 koffi）。
 * 后续模块（apis / cache / login）按 docs/design.md §9 依次接入。
 */

export { MsgApi } from "./apis/index.js";
export type { ConfigOptions, ConfigSchema } from "./config.js";
export { ConfigBase } from "./config.js";
export type { CoreContext, CoreContextOptions } from "./context.js";
export { createCoreContext } from "./context.js";
export type { CoreLoginOptions, NapukettoCoreOptions } from "./core.js";
export { NapukettoCore } from "./core.js";
export type { KernelErrorCode } from "./errors.js";
export { isKernelError, KERNEL_ERROR_CODES, KernelError, kernelError } from "./errors.js";
export type { ListenerEvents } from "./event-channel.js";
export { NTEventChannel } from "./event-channel.js";
export type { LoginResult } from "./lifecycle.js";
export { initAndStartSession, quickLogin } from "./lifecycle.js";
export type { LoggerOptions, LogLevel } from "./logger.js";
export { createLogger } from "./logger.js";
export type { PathOptions } from "./paths.js";
export { DEFAULT_DATA_ROOT_NAME, PathWrapper, resolveDataRoot } from "./paths.js";
export { probeRuntime } from "./probe.js";
export { getExistingSession, getMainSession } from "./session-resolver.js";
export type { RawMessage } from "./types/entities.js";
export { ChatType } from "./types/entities.js";
export type { MsgListener } from "./types/listeners/msg.js";
export type { CanonicalElement } from "./types/message-element.js";
export { toCanonicalElements, toSendElements } from "./types/message-element.js";
export type {
    ElementType,
    GeneralCallResult,
    NodeIKernelMsgService,
    SendMessageElement,
} from "./types/services/msg-service.js";
export type {
    DesktopPathConfig,
    DeviceInfo,
    EnginInitDesktopConfig,
    NodeIDependsAdapter,
    NodeIDispatcherAdapter,
    NodeIGlobalAdapter,
    NodeIKernelLoginService,
    NodeIKernelSessionListener,
    NodeIQQNTStartupSessionWrapper,
    NodeIQQNTWrapperEngine,
    NodeIQQNTWrapperSession,
    NodeQQNTWrapperUtil,
    PlatformType,
    RDeliveryConfig,
    VendorType,
    WrapperNodeApi,
    WrapperSessionInitConfig,
} from "./types/wrapper.js";
export {
    createLoginListener,
    createSessionListener,
    createSessionListener as createLifecycleSessionListener,
} from "./wrapper-adapters.js";
export type { SessionConfigOptions } from "./wrapper-config.js";
export {
    buildEngineConfig,
    buildLoginConfig,
    buildSessionConfig,
} from "./wrapper-config.js";
export type {
    BootEnv,
    QQVersionContext,
    StartNapukettoOptions,
    WrapperContext,
} from "./wrapper-loader.js";
export {
    createSession,
    createWrapper,
    initEngine,
    initSession,
    startNapuketto,
    startSession,
} from "./wrapper-loader.js";
export type { QQVersionInfo } from "./wrapper-version.js";
export { listQQVersions, resolveQQVersion, resolveWrapperPath } from "./wrapper-version.js";
