/**
 * 完整启动生命周期（NapCat shell 模式流程，2026-08-05 确认，自研实现）
 *
 * 参考 NapCatQQ src/shell/napcat.ts（仅理解机制，代码自研）：
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

import { kernelError } from "./errors.js";
import type { NodeIKernelSessionListener, WrapperSessionInitConfig } from "./types/wrapper.js";
import { DependsAdapter, DispatcherAdapter } from "./wrapper-adapters.js";
import type { WrapperContext } from "./wrapper-loader.js";

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

/** 登录服务形状（getLoginList / quickLoginWithUin，自研描述）。 */
type LoginServiceShape = {
    getLoginList(): Promise<{ result: number; LocalLoginInfoList: LoginAccountInfo[] }>;
    quickLoginWithUin(uin: string): Promise<{ result: string; loginErrorInfo: { errMsg: string } }>;
};

/** 列出历史登录账号（boot.cjs 启动横幅用，对齐 NapCat「可用快速登录 of QQ」）。 */
export async function listLoginAccounts(ctx: WrapperContext): Promise<LoginAccountInfo[]> {
    const raw = ctx.loginService as unknown as LoginServiceShape | null;
    if (raw === null) {
        throw kernelError("loginService 无效（缺 getLoginList）", "INVALID_STATE");
    }
    const list = await raw.getLoginList();
    return list.LocalLoginInfoList;
}

/** 快速登录：遍历历史登录列表尝试。 */
export async function quickLogin(
    ctx: WrapperContext,
    opts: { uin?: string; timeoutMs?: number },
): Promise<LoginResult> {
    const raw = ctx.loginService as unknown as LoginServiceShape | null;
    if (raw === null) {
        throw kernelError("loginService 无效（缺 getLoginList）", "INVALID_STATE");
    }
    const loginService = raw;
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
    const result = await loginService.quickLoginWithUin(target.uin);
    if (result.loginErrorInfo.errMsg) {
        throw kernelError(`快速登录失败: ${result.loginErrorInfo.errMsg}`, "NOT_LOGIN");
    }
    return {
        uin: target.uin,
        uid: target.uid ?? "",
        nick: target.nickName ?? "",
    };
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
    // 构造器；NAPI 反射读取对象方法回调——NapCat 同款机制，自研实现）。
    const depends = new DependsAdapter();
    const dispatcher = new DispatcherAdapter();

    // 等 init 完成：以 onOpentelemetryInit(is_init===true) 为主（NapCat shell 机制），
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
    try {
        session.startNT(0);
    } catch {
        try {
            session.startNT();
        } catch (e) {
            throw kernelError(`startNT 失败: ${String(e)}`, "UNKNOWN");
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
