/**
 * 完整启动生命周期（wrapper.node 契约流程，2026-08-05 实测确认，自研实现）
 *
 * 启动顺序由 wrapper.node 外部契约决定（engine→login→session→startNT），
 * 运行时实测确认，自研实现：
 *  1. engine.initWithDeskTopConfig（appid/qua/版本）
 *  2. loginService.initConfig + addKernelLoginListener
 *  3. getLoginList() → quickLoginWithUin(uin)（或 QR 登录）
 *  4. 登录成功 → genSessionConfig → session.init(config, 3 adapter, listener) → startNT(0)
 *  5. 等 init 完成信号（onOpentelemetryInit(is_init) 为主，onSessionInitComplete 为辅）
 *
 * 关键（2026-08-05 实测修正）：
 *  - session 用 `new wrapper.NodeIQQNTWrapperSession()` 创建；exports 不含 NodeI*Adapter/Listener
 *    构造器（89 键实测无）——adapter 与 listener 一律传普通 JS 对象（NAPI 反射读取方法回调）。
 *
 * 模块边界（2026-08-05 解耦）：
 *  - 配置装配（buildEngineConfig / buildLoginConfig / buildSessionConfig）→ wrapper-config.ts
 *  - NAPI 回调适配器（GlobalAdapter / DependsAdapter / DispatcherAdapter / listener 工厂）→ wrapper-adapters.ts
 *  - 本文件只保留流程编排：快速登录 + session 初始化 + init 完成信号等待。
 */

import { kernelError } from "../infra/errors.js";
import type { NodeIKernelSessionListener, WrapperSessionInitConfig } from "../types/wrapper.js";
import {
    createLoginListener,
    DependsAdapter,
    DispatcherAdapter,
} from "../wrapper/wrapper-adapters.js";
import type { WrapperContext } from "../wrapper/wrapper-loader.js";

/** 等待条件满足（轮询，带超时）。 */
function waitFor(predicate: () => boolean, timeoutMs: number, intervalMs = 500): Promise<boolean> {
    return new Promise((resolve) => {
        const started = Date.now();
        const tick = (): void => {
            if (predicate()) {
                resolve(true);
                return;
            }
            if (Date.now() - started > timeoutMs) {
                resolve(false);
                return;
            }
            setTimeout(tick, intervalMs);
        };
        tick();
    });
}

/** session init 默认超时（毫秒）。 */
const DEFAULT_INIT_TIMEOUT_MS = 15_000;

/** session 就绪等待默认超时（毫秒）。 */
const SESSION_READY_TIMEOUT_MS = 30_000;

/** session 就绪轮询间隔（毫秒）。 */
const SESSION_READY_POLL_MS = 1000;

/**
 * 等待 QQ 自己完成 session 初始化（framework 复用模式，2026-08-05 修正）。
 *
 * 背景：QQ 9.9.31 实测——session 由 QQ 主进程自己创建并 init（登录后）。
 * 我们不自己 init（重复 init 断言 "implementation of IQQNTWrapperSession is not valid"），
 * 也不自己 create（登录前 create() 干扰 QQ，实测 QQ 退出 code=0）。
 * 正确做法：等 QQ 的 session 就绪（getMsgService 非 null = 核心 service 已挂载）。
 */
export async function waitSessionReady(
    ctx: WrapperContext,
    opts: { timeoutMs?: number },
): Promise<void> {
    const { session } = ctx;
    if (session === null || session === undefined) {
        throw kernelError("session 未创建", "INVALID_STATE");
    }
    const ok = await waitFor(
        () => {
            try {
                const svc = session.getMsgService();
                return svc !== null && svc !== undefined;
            } catch {
                return false;
            }
        },
        opts.timeoutMs ?? SESSION_READY_TIMEOUT_MS,
        SESSION_READY_POLL_MS,
    );
    if (!ok) {
        throw kernelError("等待 QQ session 就绪超时（QQ 未完成 init）", "TIMEOUT");
    }
}

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
    const connect = raw.connect; // 提取局部变量（闭包内属性 narrowing 失效，TS2722）
    const addListener = raw.addKernelLoginListener;
    await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
            if (!settled) {
                settled = true;
                resolve();
            }
        };
        try {
            // 临时监听等 onLoginConnected；保留不 remove——登录后续回调
            // （onQRCodeLoginSucceed 等）仍可能触发，且进程内只登录一次，无泄漏风险。
            const listener = createLoginListener();
            listener.onLoginConnected = () => {
                finish();
            };
            if (typeof addListener === "function") {
                addListener(listener);
            }
        } catch {
            // 监听注册失败不阻塞连接
        }
        setTimeout(finish, opts.timeoutMs ?? NETWORK_READY_TIMEOUT_MS);
        try {
            connect();
        } catch {
            finish();
        }
    });
    // onLoginConnected 后网络栈仍在初始化（p0-kernel-flow 实证：connect → onLoginConnected
    // → 3s 缓冲 → quickLoginWithUin 成功；无缓冲则「登录系统连接异常」）。
    await sleep(CONNECTION_SETTLE_MS);
}

/** 连接稳定缓冲（毫秒，p0-kernel-flow 实证值）。 */
const CONNECTION_SETTLE_MS = 3000;

/** 短延迟。 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
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
    let target = items.find((i) => i.isQuickLogin);
    if (target === undefined) {
        const [first] = items;
        target = first;
    }
    if (opts.uin !== undefined) {
        const byUin = items.find((i) => i.uin === opts.uin);
        if (byUin !== undefined) {
            target = byUin;
        }
    }
    if (target === undefined) {
        throw kernelError(`账号 ${opts.uin ?? ""} 不在登录列表`, "NOT_FOUND");
    }

    // 网络重试循环：1006511（网络未就绪）→ 等 MSF 连接 → 重试（最多 NETWORK_RETRY_MAX 次）
    return loginWithNetworkRetry(ctx, loginService, target, opts);
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
        const result = await loginService.quickLoginWithUin(target.uin);
        const { errMsg } = result.loginErrorInfo;
        if (!errMsg) {
            return {
                uin: target.uin,
                uid: target.uid ?? "",
                nick: target.nickName ?? "",
            };
        }
        lastErrMsg = errMsg;
        const isNetworkError =
            errMsg.includes(NETWORK_ERROR_CODE) || errMsg.includes(CONNECTION_ERROR_HINT);
        if (!isNetworkError || attempt >= NETWORK_RETRY_MAX) {
            break;
        }
        // 网络未就绪 → 等连接后重试（不无限重试）
        const ready = await waitForNetworkConnection(ctx, {
            timeoutMs: opts.timeoutMs ?? NETWORK_READY_TIMEOUT_MS,
        });
        if (!ready) {
            break;
        }
    }
    throw kernelError(`快速登录失败: ${lastErrMsg}`, "NOT_LOGIN");
}

/** session 初始化（4 参全为普通 JS 对象，等 init 完成信号）。 */
export async function initAndStartSession(
    ctx: WrapperContext,
    config: WrapperSessionInitConfig,
    listener: NodeIKernelSessionListener,
    opts: { timeoutMs?: number },
): Promise<void> {
    const { session } = ctx;
    if (session === null || session === undefined) {
        throw kernelError("session 未创建", "INVALID_STATE");
    }

    // adapter / listener 全部用普通 JS 对象（实测 exports 89 键无 NodeI*Adapter/Listener
    // 构造器；NAPI 反射读取对象方法回调，自研实现）。
    const depends = new DependsAdapter();
    const dispatcher = new DispatcherAdapter();

    // 等 init 完成：以 onOpentelemetryInit(is_init===true) 为主（wrapper 契约），
    // onSessionInitComplete(0) 为辅；非 0 即失败。
    const initComplete = new Promise<void>((resolve, reject) => {
        const onOpentelemetry = listener.onOpentelemetryInit;
        listener.onOpentelemetryInit = (info) => {
            if (info.is_init) {
                resolve();
            }
            if (typeof onOpentelemetry === "function") {
                onOpentelemetry(info);
            }
        };
        const onInitComplete = listener.onSessionInitComplete;
        listener.onSessionInitComplete = (r) => {
            if (r === 0 || r === "0") {
                resolve();
            } else {
                reject(kernelError(`session init 失败: ${String(r)}`, "UNKNOWN"));
            }
            if (typeof onInitComplete === "function") {
                onInitComplete(r);
            }
        };
    });

    session.init(config, depends, dispatcher, listener);
    // 启动：**先 init 后 start（2026-08-07 V9 决定性修正）**。
    // 自建宿主实测（HANDOVER-V9，p0-napcat-min）：必须先 session.init 再
    // startupSession.start()——顺序颠倒（先 start 后 init）业务 service 不挂载
    // （getMsgService null）；init 后用 startNT（非 startupSession.start）也失败。
    // NapCat initializeSession 同款：有 startupSession 用 start()，否则 startNT(0)。
    const { startupSession } = ctx;
    if (startupSession !== null && typeof startupSession.start === "function") {
        try {
            startupSession.start();
        } catch {
            // start 失败不致命，靠 onOpentelemetryInit/onSessionInitComplete 信号判断
        }
    } else {
        try {
            session.startNT(0);
        } catch {
            try {
                session.startNT();
            } catch {
                // 无 startNT（9.9.31）：忽略，等 init 完成信号
            }
        }
    }

    const ok = await Promise.race([
        initComplete.then(() => true),
        waitFor(() => false, opts.timeoutMs ?? DEFAULT_INIT_TIMEOUT_MS).then(() => false),
    ]);
    if (!ok) {
        throw kernelError("session init 超时", "TIMEOUT");
    }
}
