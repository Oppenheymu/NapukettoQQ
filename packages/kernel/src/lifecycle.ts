/**
 * 完整启动生命周期（NapCat shell 模式流程，2026-08-05 确认，自研实现）
 *
 * 参考 NapCatQQ src/shell/napcat.ts（仅理解机制，代码自研）：
 *  1. engine.initWithDeskTopConfig（appid/qua/版本）
 *  2. loginService.initConfig + addKernelLoginListener
 *  3. getLoginList() → quickLoginWithUin(uin)（或 QR 登录）
 *  4. 登录成功 → genSessionConfig → session.init(config, 3 adapter, listener)
 *  5. session.startNT(0) → 等 onSessionInitComplete === 0 → Ready
 *
 * 关键：session 用 `new wrapper.NodeIQQNTWrapperSession()` 创建（不是 getNTWrapperSession
 * ——后者返回空 session）；adapters 用 `new wrapper.NodeIXxxAdapter({...})` 包装。
 */

import { hostname } from "node:os";
import process from "node:process";
import { kernelError } from "./errors.js";
import type {
    DeviceInfo,
    EnginInitDesktopConfig,
    NodeIKernelLoginListener,
    NodeIKernelSessionListener,
    WrapperSessionInitConfig,
} from "./types/wrapper.js";
import { PlatformType as PlatformTypeValue, VendorType } from "./types/wrapper.js";
import type { WrapperContext } from "./wrapper-loader.js";

/** 系统信息（NapCat 用 fixed 值即可，真实环境探测后补）。 */
function systemInfo(): { platVer: string; osVersion: string; devType: string } {
    return {
        platVer: "Windows 10.0.22631",
        osVersion: "Windows 10 Pro",
        devType: "Windows",
    };
}

/** Windows 兜底 appid/qua（NapCat appid.json 9.9.31 缺失时）。 */
function resolveAppidQua(fullVersion: string): { appid: string; qua: string } {
    // 预留：后续可从 appid.json 表扩展
    return {
        appid: "537237765",
        qua: `V1_WIN_NQ_${fullVersion}_${fullVersion.split("-")[1] ?? ""}_GW_B`,
    };
}

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

/** 生成 engine 桌面配置（NapCat shell 同款字段）。 */
export function buildEngineConfig(
    fullVersion: string,
    dataPathGlobal: string,
): EnginInitDesktopConfig {
    const { osVersion } = systemInfo();
    const { qua } = resolveAppidQua(fullVersion);
    return {
        base_path_prefix: "",
        platform_type: PlatformTypeValue.KWINDOWS,
        app_type: 4,
        app_version: fullVersion,
        os_version: osVersion,
        use_xlog: true,
        qua,
        global_path_config: {
            desktopGlobalPath: dataPathGlobal,
        },
        thumb_config: { maxSide: 324, minSide: 48, longLimit: 6, density: 2 },
    };
}

/** 生成登录初始化配置。 */
export function buildLoginConfig(
    appid: string,
    fullVersion: string,
    commonPath: string,
): Record<string, unknown> {
    const { platVer } = systemInfo();
    return {
        machineId: "",
        appid,
        platVer,
        commonPath,
        clientVer: fullVersion,
        hostName: hostname(),
    };
}

/** buildSessionConfig 参数。 */
export interface SessionConfigOptions {
    appid: string;
    fullVersion: string;
    selfUin: string;
    selfUid: string;
    accountPath: string;
    downloadPath: string;
}

/** 生成 session 初始化配置（登录成功后调用）。 */
export function buildSessionConfig(options: SessionConfigOptions): WrapperSessionInitConfig {
    const { appid, fullVersion, selfUin, selfUid, accountPath, downloadPath } = options;
    const { platVer, osVersion, devType } = systemInfo();
    const deviceInfo: DeviceInfo = {
        guid: "", // TODO: 从 LoginService 获取（NapCat: getMachineId）
        buildVer: fullVersion,
        localId: 2052,
        devName: hostname(),
        devType,
        vendorName: "",
        osVer: osVersion,
        vendorOsName: devType,
        setMute: false,
        vendorType: VendorType.KNOSETONIOS,
    };
    return {
        selfUin,
        selfUid,
        desktopPathConfig: {
            account_path: accountPath,
        },
        clientVer: fullVersion,
        a2: "",
        d2: "",
        d2Key: "",
        machineId: "",
        platform: PlatformTypeValue.KWINDOWS,
        platVer,
        appid,
        rdeliveryConfig: {
            appKey: "",
            systemId: 0,
            appId: "",
            logicEnvironment: "",
            platform: PlatformTypeValue.KWINDOWS,
            language: "",
            sdkVersion: "",
            userId: "",
            appVersion: "",
            osVersion: "",
            bundleId: "",
            serverUrl: "",
            fixedAfterHitKeys: [""],
        },
        defaultFileDownloadPath: downloadPath,
        deviceInfo,
        deviceConfig: '{"appearance":{"isSplitViewMode":true},"msg":{}}',
    };
}

/** 登录结果（QR 或快速登录）。 */
export interface LoginResult {
    uin: string;
    uid: string;
    nick: string;
}

/** 快速登录：遍历历史登录列表尝试。 */
export async function quickLogin(
    ctx: WrapperContext,
    opts: { uin?: string; timeoutMs?: number },
): Promise<LoginResult> {
    const raw = ctx.loginService as unknown as {
        getLoginList(): Promise<{
            result: number;
            LocalLoginInfoList: { uin: string; uid?: string; isQuickLogin?: boolean }[];
        }>;
        quickLoginWithUin(
            uin: string,
        ): Promise<{ result: string; loginErrorInfo: { errMsg: string } }>;
    } | null;
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
        nick: "",
    };
}

/** session 初始化（4 参全为 NAPI 包装对象，等 onSessionInitComplete）。 */
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
    const wrapper = ctx.exports;

    // adapter 用 wrapper 的 NAPI 构造器包装（不是裸对象）
    const depends = new wrapper.NodeIDependsAdapter({});
    const dispatcher = new wrapper.NodeIDispatcherAdapter({});
    const sessionListener = new wrapper.NodeIKernelSessionListener(listener);

    // 等 init 完成
    const initComplete = new Promise<void>((resolve, reject) => {
        const orig = listener.onSessionInitComplete;
        listener.onSessionInitComplete = (r) => {
            if (r === 0 || r === "0") {
                resolve();
            } else {
                reject(kernelError(`session init 失败: ${String(r)}`, "UNKNOWN"));
            }
            if (typeof orig === "function") {
                orig(r);
            }
        };
    });

    session.init(config, depends, dispatcher, sessionListener);
    try {
        session.startNT(0);
    } catch {
        try {
            session.startNT();
        } catch (e) {
            throw kernelError(`startNT 失败: ${String(e)}`, "UNKNOWN");
        }
    }

    const done = await Promise.race([
        initComplete,
        waitFor(() => false, opts.timeoutMs ?? DEFAULT_INIT_TIMEOUT_MS),
    ]);
    if (!done) {
        throw kernelError("session init 超时", "TIMEOUT");
    }
}

/** 生成会话监听器（日志版，init 完成日志）。 */
export function createLifecycleSessionListener(): NodeIKernelSessionListener {
    const log = (msg: string, ...rest: unknown[]): void => {
        process.stdout.write(`[napuketto:session] ${msg} ${rest.map(String).join(" ")}\n`);
    };
    return {
        onNTSessionCreate: (sessionId) => log("onNTSessionCreate", sessionId),
        onGProSessionCreate: (sessionId) => log("onGProSessionCreate", sessionId),
        onSessionInitComplete: (sessionId) => log("onSessionInitComplete", sessionId),
        onOpentelemetryInit: (info) => log("onOpentelemetryInit", info),
        onUserOnlineResult: (result) => log("onUserOnlineResult", result),
        onGetSelfTinyId: (result) => log("onGetSelfTinyId", result),
    };
}

/** 创建登录监听器（当前登录器需要时用）。 */
export function createLoginListener(): NodeIKernelLoginListener {
    return {} as NodeIKernelLoginListener;
}
