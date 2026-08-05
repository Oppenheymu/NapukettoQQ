/**
 * OB11 错误码映射表（ADR-017：协议层只维护映射，不解析逻辑）
 *
 * kernel 抛 KernelError（带 KernelErrorCode），各协议维护一份
 * KernelErrorCode → 协议错误码 的映射；BaseAction 统一做映射。
 */

import type { ErrorCodeMap } from "../../core/index.js";

/** OB11 错误码映射表（send_msg 等所有 OB11 动作共用）。 */
export const ob11ErrorCodeMap: ErrorCodeMap = {
    SEND_FAILED: 100,
    PERMISSION_DENIED: 101,
    NOT_FOUND: 102,
    TIMEOUT: 103,
    NOT_LOGIN: 104,
    INVALID_PARAM: 105,
    INVALID_STATE: 106,
    UNKNOWN: 999,
};
