/**
 * 登录连接与快速登录（从 lifecycle.ts 拆分，2026-08-08 FTA 优化）
 *
 * - waitForNetworkConnection：等 MSF 网络连接就绪（getMsfStatus() === 3）
 * - ensureLoginConnected：connect() → 等 onLoginConnected（自建宿主必需）
 * - quickLogin：历史账号快速登录（网络异常 1006511 等就绪后重试）
 */

import { kernelError } from "../infra/index.js";
import { createLoginListener } from "../wrapper/wrapper-adapters.js";
import type { WrapperContext } from "../wrapper/wrapper-loader.js";
import { sleep, waitFor } from "./wait.js";

/** 登录结果（QR 或快速登录）。 */
export interface LoginResult {
    uin: string;
    uid: string;
    nick: string;
}

/** 登录列表项（getLoginList 返回，说明书参考）。 */
export interface LoginAccountInfo {
    uin: string;
    uid?: string;
    nickName?: string;
    isQuickLogin?: boolean;
}

/** 登录服务形状（getLoginList / quickLoginWithUin / getMsfStatus，自研描述）。 */
type LoginServiceShape = {
    getLoginList(): Promise<{ result: number; LocalLoginInfoList: LoginAccountInfo[] }>;
    quickLoginWithUin(uin: string): Promise<{ result: string; loginErrorInfo: { errMsg: string } }>;
    getMsfStatus(): number;
};

/**
 * 网络状态（MSF）常量。
 * 3 = 已连接（NapCat waitForNetworkConnection 语义，自研描述）。
 */
const MSF_STATUS_CONNECTED = 3;

/** 快速登录网络异常错误码（1006511，P2-1 实测：登录前网络未就绪时报此错）。 */
const NETWORK_ERROR_CODE = "1006511";

/** 登录连接异常错误提示（自建宿主实测：connect 后未缓冲即 quickLogin 报此错）。 */
const CONNECTION_ERROR_HINT = "登录系统连接异常";

/** 网络重试最大次数（每次重试前等网络就绪）。 */
const NETWORK_RETRY_MAX = 3;

/** 网络就绪等待超时（毫秒）。 */
const NETWORK_READY_TIMEOUT_MS = 15_000;

/** 网络就绪轮询间隔（毫秒）。 */
const NETWORK_READY_POLL_MS = 1000;

/** 连接稳定缓冲（毫秒，p0-kernel-flow 实证值）。 */
const CONNECTION_SETTLE_MS = 3000;

/**
 * 等待网络连接就绪（loginService.getMsfStatus() === 3）。
 * 参考 NapCat waitForNetworkConnection 思路（自研实现）：快速登录在 QQ 刚拉起、
 * 网络栈未初始化时报 1006511 网络异常——等待 MSF 连接后再重试。
 * @returns 是否在超时前就绪。
 */
export function waitForNetworkConnection(
    ctx: WrapperContext,
    opts: { timeoutMs?: number } = {},
): Promise<boolean> {
    const raw = ctx.loginService as unknown as LoginServiceShape | null;
    if (raw === null || typeof raw.getMsfStatus !== "function") {
        return Promise.resolve(false);
    }
    return waitFor(
        () => {
            try {
                return raw.getMsfStatus() === MSF_STATUS_CONNECTED;
            } catch {
                return false;
            }
        },
        opts.timeoutMs ?? NETWORK_READY_TIMEOUT_MS,
        NETWORK_READY_POLL_MS,
    );
}

/** 列出历史登录账号（boot.cjs 启动横幅用，「可用快速登录 of QQ」）。 */
export async function listLoginAccounts(ctx: WrapperContext): Promise<LoginAccountInfo[]> {
    const raw = ctx.loginService as unknown as LoginServiceShape | null;
    if (raw === null) {
        throw kernelError("loginService 无效（缺 getLoginList）", "INVALID_STATE");
    }
    const list = await raw.getLoginList();
    return list.LocalLoginInfoList;
}

/**
 * 登录服务连接（自建宿主必需，HANDOVER-V6/V10 p0-kernel-flow 实证顺序）：
 * connect() → 等 onLoginConnected。不 connect 则快速登录报「登录系统连接异常」。
 *
 * 对齐 p0-kernel-flow：initConfig → getLoginList → connect + onLoginConnected →
 * quickLoginWithUin。QQ 环境（worker/主进程）下可能已连接——connect 幂等，
 * 监听器超时兜底，不影响原流程。
 */
async function ensureLoginConnected(
    ctx: WrapperContext,
    opts: { timeoutMs?: number },
): Promise<void> {
    const raw = ctx.loginService as unknown as {
        connect?: () => void;
        addKernelLoginListener?: (listener: unknown) => number;
    } | null;
    if (raw === null || typeof raw.connect !== "function") {
        return; // 无 connect（老版本 / QQ 主进程自连），跳过
    }
    await waitLoginConnected(raw, opts.timeoutMs);
    // onLoginConnected 后网络栈仍在初始化（p0-kernel-flow 实证：connect → onLoginConnected
    // → 3s 缓冲 → quickLoginWithUin 成功；无缓冲则「登录系统连接异常」）。
    await sleep(CONNECTION_SETTLE_MS);
}

/** 等 onLoginConnected（注册临时监听 + connect + 超时兜底）。 */
function waitLoginConnected(
    raw: {
        connect?: () => void;
        addKernelLoginListener?: (listener: unknown) => number;
    },
    timeoutMs?: number,
): Promise<void> {
    return new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
            if (!settled) {
                settled = true;
                resolve();
            }
        };
        tryRegisterConnectListener(raw, finish);
        setTimeout(finish, timeoutMs ?? NETWORK_READY_TIMEOUT_MS);
        try {
            raw.connect?.();
        } catch {
            finish();
        }
    });
}

/** 注册临时登录连接监听（失败不阻塞连接）。 */
function tryRegisterConnectListener(
    raw: {
        connect?: () => void;
        addKernelLoginListener?: (listener: unknown) => number;
    },
    finish: () => void,
): void {
    try {
        // 临时监听等 onLoginConnected；保留不 remove——登录后续回调
        // （onQRCodeLoginSucceed 等）仍可能触发，且进程内只登录一次，无泄漏风险。
        const listener = createLoginListener();
        listener.onLoginConnected = () => {
            finish();
        };
        if (typeof raw.addKernelLoginListener === "function") {
            raw.addKernelLoginListener(listener);
        }
    } catch {
        // 监听注册失败不阻塞连接
    }
}

/**
 * 目标账号选择（2026-08-07 修复：显式 uin 不在列表时**报错**而非静默 fallback——
 * 之前会退到第一个可快速登录账号，导致 `-q <uin>` 实际登成别的号）。
 * 导出供单测（login-connect.test.ts）。
 */
export function pickLoginTarget(
    items: LoginAccountInfo[],
    uin: string | undefined,
): LoginAccountInfo {
    if (uin !== undefined) {
        const target = items.find((i) => i.uin === uin);
        if (target === undefined) {
            const available = items.map((i) => i.uin).join("、");
            throw kernelError(`账号 ${uin} 不在登录列表（可用：${available}）`, "NOT_FOUND");
        }
        return target;
    }
    // 未指定 uin：优先第一个可快速登录账号，否则列表第一个
    const quick = items.find((i) => i.isQuickLogin);
    if (quick !== undefined) {
        return quick;
    }
    const [first] = items;
    if (first === undefined) {
        throw kernelError("无可用登录账号", "NOT_LOGIN");
    }
    return first;
}

/**
 * 带网络重试的快速登录（P2-1）。
 * 重试语义：仅当失败为网络异常（1006511）且未达上限时，等网络就绪后重试。
 */
async function loginWithNetworkRetry(
    ctx: WrapperContext,
    loginService: LoginServiceShape,
    target: LoginAccountInfo,
    opts: { uin?: string; timeoutMs?: number },
): Promise<LoginResult> {
    let lastErrMsg = "";
    for (let attempt = 1; attempt <= NETWORK_RETRY_MAX; attempt += 1) {
        const attemptResult = await attemptQuickLogin(loginService, target);
        if (attemptResult.ok) {
            return attemptResult.result;
        }
        lastErrMsg = attemptResult.errMsg;
        const shouldRetry = isNetworkError(lastErrMsg) && attempt < NETWORK_RETRY_MAX;
        if (!shouldRetry) {
            break;
        }
        const ready = await waitForNetworkConnection(ctx, {
            timeoutMs: opts.timeoutMs ?? NETWORK_READY_TIMEOUT_MS,
        });
        if (!ready) {
            break;
        }
    }
    throw kernelError(`快速登录失败: ${lastErrMsg}`, "NOT_LOGIN");
}

/** 单次快速登录尝试（成功带结果，失败带错误消息）。 */
async function attemptQuickLogin(
    loginService: LoginServiceShape,
    target: LoginAccountInfo,
): Promise<{ ok: true; result: LoginResult } | { ok: false; errMsg: string }> {
    const result = await loginService.quickLoginWithUin(target.uin);
    const { errMsg } = result.loginErrorInfo;
    if (errMsg) {
        return { ok: false, errMsg };
    }
    return {
        ok: true,
        result: {
            uin: target.uin,
            uid: target.uid ?? "",
            nick: target.nickName ?? "",
        },
    };
}

/** 判定快速登录失败是否为网络异常（重试语义）。导出供单测。 */
export function isNetworkError(errMsg: string): boolean {
    return errMsg.includes(NETWORK_ERROR_CODE) || errMsg.includes(CONNECTION_ERROR_HINT);
}

/**
 * 快速登录：遍历历史登录列表尝试。
 * P2-1：失败且错误为网络异常（1006511）时，等网络就绪后重试（最多 NETWORK_RETRY_MAX 次）。
 */
export async function quickLogin(
    ctx: WrapperContext,
    opts: { uin?: string; timeoutMs?: number },
): Promise<LoginResult> {
    const raw = ctx.loginService as unknown as LoginServiceShape | null;
    if (raw === null) {
        throw kernelError("loginService 无效（缺 getLoginList）", "INVALID_STATE");
    }
    const loginService = raw;
    // 连接登录服务（自建宿主必需：不 connect 则「登录系统连接异常」）
    await ensureLoginConnected(ctx, {
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
    const list = await loginService.getLoginList();
    const items = list.LocalLoginInfoList;
    if (items.length === 0) {
        throw kernelError("无历史登录账号", "NOT_LOGIN");
    }
    const target = pickLoginTarget(items, opts.uin);
    return loginWithNetworkRetry(ctx, loginService, target, opts);
}
