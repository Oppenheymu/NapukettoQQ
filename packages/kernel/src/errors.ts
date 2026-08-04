/**
 * kernel 类型化错误（ADR-009 / ADR-017）
 *
 * apis 层内部解包原生 `{ result, errMsg }`：成功返回纯业务值，失败抛 KernelError。
 * 协议层只需维护 `KernelErrorCode → 协议错误码` 映射表，不解析错误逻辑。
 */

/**
 * 错误码分类。P1 探测真实错误返回后再增删。
 * 当前 INVALID_PARAM 也承担基础设施层（配置校验失败等）的错误语义。
 */
export type KernelErrorCode =
    | "SEND_FAILED" // 发送失败（原生拒绝）
    | "PERMISSION_DENIED" // 无权限（禁言、非管理员等）
    | "NOT_FOUND" // 目标不存在（群/成员/消息）
    | "TIMEOUT" // 操作超时（含文件预测超时）
    | "NOT_LOGIN" // 未登录或已掉线
    | "INVALID_PARAM" // 参数非法（原生拒绝 / 配置校验失败）
    | "UNKNOWN"; // 兜底

/**
 * 全部错误码集合。协议层映射表可据此推导：
 * `Record<(typeof KERNEL_ERROR_CODES)[number], number>`。
 */
export const KERNEL_ERROR_CODES = [
    "SEND_FAILED",
    "PERMISSION_DENIED",
    "NOT_FOUND",
    "TIMEOUT",
    "NOT_LOGIN",
    "INVALID_PARAM",
    "UNKNOWN",
] as const;

/** kernel 类型化错误：apis / 基础设施层抛出的统一错误形态。 */
export class KernelError extends Error {
    readonly code: KernelErrorCode;

    constructor(message: string, code: KernelErrorCode = "UNKNOWN", options?: ErrorOptions) {
        super(message, options);
        this.name = "KernelError";
        this.code = code;
    }
}

/** 便捷构造：`kernelError('消息不存在', 'NOT_FOUND', { cause })`。 */
export function kernelError(
    message: string,
    code: KernelErrorCode = "UNKNOWN",
    options?: ErrorOptions,
): KernelError {
    return new KernelError(message, code, options);
}

/** 类型守卫：协议层 catch 统一映射时区分 KernelError 与意外错误。 */
export function isKernelError(err: unknown): err is KernelError {
    return err instanceof KernelError;
}
