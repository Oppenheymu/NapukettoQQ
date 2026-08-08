/**
 * 原生调用结果解包（ADR-009 统一错误语义）
 *
 * wrapper.node 的 service 方法大多返回 `{ result, errMsg }`：
 *  - unwrap：result 为 number 且非 0 → 抛 KernelError
 *  - checkLooseResult：宽松形状（result 可能缺失/非数字）→ 仅当 result 为
 *    数字且非 0 时抛错（探测期兼容：某些 API 成功时 result 缺省或为对象）
 *  - unwrapResult：result !== 0 → 按 errMsg 内容映射语义错误码（msg 系专用）
 */

import { kernelError } from "../infra/errors.js";
import type { GeneralCallResult } from "../types/services/msg-service.js";

/** 原生 result 解包（result 字段非 0 抛 KernelError）。 */
export function unwrap(label: string, result: number, errMsg?: string): void {
    if (result === 0) {
        return;
    }
    throw kernelError(`${label} 失败: ${errMsg ?? "无错误详情"}`, "UNKNOWN");
}

/** 宽松 result 校验（result 为数字非 0 视为失败；缺失/非数字视为成功）。 */
export function checkLooseResult(
    label: string,
    res: { result?: unknown; errMsg?: unknown } | null | undefined,
): void {
    if (res === undefined || res === null || typeof res.result !== "number" || res.result === 0) {
        return;
    }
    throw kernelError(`${label} 失败: ${String(res.errMsg ?? "")}`, "UNKNOWN");
}

/** 原生结果解包：result !== 0 抛 KernelError（errMsg 语义映射错误码）。 */
export function unwrapResult<T extends GeneralCallResult>(label: string, raw: T): void {
    if (raw.result === 0) {
        return;
    }
    const msg = raw.errMsg || "无错误详情";
    let code: "SEND_FAILED" | "NOT_FOUND" | "NOT_LOGIN" | "PERMISSION_DENIED" | "UNKNOWN" =
        "UNKNOWN";
    if (msg.includes("未登录") || msg.includes("login")) {
        code = "NOT_LOGIN";
    } else if (msg.includes("无权限") || msg.includes("permission")) {
        code = "PERMISSION_DENIED";
    } else if (msg.includes("不存在") || msg.includes("not found")) {
        code = "NOT_FOUND";
    } else if (label === "sendMsg") {
        code = "SEND_FAILED";
    }
    throw kernelError(`${label} 失败: ${msg}`, code);
}
