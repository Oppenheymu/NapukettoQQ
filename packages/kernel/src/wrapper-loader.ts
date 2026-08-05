/**
 * wrapper 引导（NAPI 范式，2026-08-05 重构，替代旧 koffi 方案）
 *
 * 事实（实测）：wrapper.node 不是标准 NAPI self-register 模块，只能在 QQ 定制版
 * Electron 主进程里由 preload 注册。@napuketto/loader 注入 hook DLL 后，boot.cjs
 * 在 QQ 主进程内截获 `process.dlopen` 的 `module.exports`，然后调用本模块初始化。
 *
 * 本模块**不再**使用 koffi / vtable / 内存偏移——所有对象由 QQ 的 NAPI 层自动构建。
 * 业务层拿到的都是真实 JS 对象：engine.initWithDeskTopConfig(config, adapter) 等。
 */

import process from "node:process";
import { kernelError } from "./errors.js";
import { getMainSession } from "./session-resolver.js";
import type {
    EnginInitDesktopConfig,
    NodeIDependsAdapter,
    NodeIDispatcherAdapter,
    NodeIGlobalAdapter,
    NodeIKernelSessionListener,
    NodeIQQNTWrapperEngine,
    NodeIQQNTWrapperSession,
    WrapperNodeApi,
    WrapperSessionInitConfig,
} from "./types/wrapper.js";
import { PlatformType } from "./types/wrapper.js";

/** NodeIGlobalAdapter 空实现（engine.initWithDeskTopConfig 第二参）。 */
class GlobalAdapter implements NodeIGlobalAdapter {}

/** NodeIDependsAdapter 空实现（session.init 第二参）。 */
class DependsAdapter implements NodeIDependsAdapter {}

/** NodeIDispatcherAdapter 空实现（session.init 第三参）。 */
class DispatcherAdapter implements NodeIDispatcherAdapter {}

// ---------------------------------------------------------------
// startNapuketto 内部辅助（非 export，boot 装配用）
// ---------------------------------------------------------------

/** 日志版 session 监听器（boot 阶段默认，login 模块可覆盖）。 */
function createBootListener(): NodeIKernelSessionListener {
    // pino logger 此时可能未初始化（kernel 主配置未装配），先走 stdout
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

/** 默认 engine 配置（KWINDOWS + 版本号，字段待首个真实联调确认）。 */
function defaultEngineConfig(env: BootEnv): EnginInitDesktopConfig {
    let osVersion = process.platform;
    if (process.platform === "win32") {
        osVersion = "win32";
    }
    return {
        base_path_prefix: env.dataDir ?? "",
        platform_type: PlatformType.KWINDOWS,
        app_type: 4,
        app_version: env.qqVersion ?? "",
        os_version: osVersion,
        use_xlog: false,
        qua: "",
        global_path_config: {
            desktopGlobalPath: env.dataDir ?? "",
        },
        thumb_config: { maxSide: 324, minSide: 48, longLimit: 6, density: 2 },
    };
}

// ---------------------------------------------------------------
// 导出区（useExportsLast：export 全部在文件末尾）
// ---------------------------------------------------------------

/** QQ 版本信息（登录握手用）。 */
export interface QQVersionContext {
    fullVersion: string;
    buildVersion: string;
}

/** 已引导的 wrapper 上下文（运行在 QQ Electron 主进程内）。 */
export interface WrapperContext {
    /** wrapper.node 的 NAPI 顶层导出。 */
    exports: WrapperNodeApi;
    /** engine 单例（get() 已调用）。 */
    engine: NodeIQQNTWrapperEngine;
    /** 版本信息（供登录握手等使用）。 */
    versionInfo: QQVersionContext;
    /** 会话（QQ 拦截捕获 / createSession 后填充）。 */
    session: NodeIQQNTWrapperSession | null;
    /** QQ 的 loginService 实例（拦截 new 捕获，可为 null）。 */
    loginService: unknown;
}

/**
 * 从 loader 截获的 NAPI exports 创建 wrapper 上下文。
 * 在 QQ 主进程内调用（boot.cjs → kernel 入口）。
 */
export function createWrapper(
    exports: WrapperNodeApi,
    versionInfo: QQVersionContext,
): WrapperContext {
    const engineMaybe = exports.NodeIQQNTWrapperEngine as unknown as {
        get?: () => NodeIQQNTWrapperEngine;
    } | null;
    if (engineMaybe === null || typeof engineMaybe.get !== "function") {
        throw kernelError(
            "wrapper.node exports 无效（缺少 NodeIQQNTWrapperEngine）",
            "INVALID_PARAM",
        );
    }
    const engine = engineMaybe.get();
    if (!engine || typeof engine.initWithDeskTopConfig !== "function") {
        throw kernelError("NodeIQQNTWrapperEngine.get() 返回对象无效", "INVALID_PARAM");
    }
    return { exports, engine, versionInfo, session: null, loginService: null };
}

/** engine 初始化（NapCat 语义：先 engine 后 session）。config 为普通 JS 对象。 */
export function initEngine(ctx: WrapperContext, config: EnginInitDesktopConfig): void {
    ctx.engine.initWithDeskTopConfig(config, new GlobalAdapter());
}

/** 创建会话：`new wrapper.NodeIQQNTWrapperSession()`（NapCat shell 模式确认）。
 * 注：不用 startup.create()/getNTWrapperSession——那些返回未 init 的空 session。 */
export function createSession(ctx: WrapperContext): NodeIQQNTWrapperSession {
    const S = ctx.exports.NodeIQQNTWrapperSession;
    let session: NodeIQQNTWrapperSession;
    try {
        session = new S();
    } catch {
        session = new S();
    }
    ctx.session = session;
    return session;
}

/** session 初始化（4 参全为 JS 对象，NAPI 自动转换）。 */
export function initSession(
    ctx: WrapperContext,
    config: WrapperSessionInitConfig,
    listener: NodeIKernelSessionListener,
): void {
    const session = ctx.session ?? createSession(ctx);
    session.init(config, new DependsAdapter(), new DispatcherAdapter(), listener);
}

/** 启动会话（startNT(0)，NapCat 语义）。 */
export function startSession(ctx: WrapperContext): void {
    const { session } = ctx;
    if (session === null) {
        throw kernelError("session 未创建，无法 startNT", "INVALID_STATE");
    }
    session.startNT(0);
}

/**
 * boot 装配入口：createWrapper → initEngine → session。
 *
 * **session 来源优先级（2026-08-05 修正，NapCat 机制确认）**：
 *  1. qqSession（boot.cjs 拦截 `new` 窃取的 QQ 已 init session）——**首选**
 *  2. getMainSession（startup.create → getNTWrapperSession）
 *  3. createSession（自己 create，空 session）
 *
 * 由 loader runtime/boot.cjs 在 QQ 主进程内调用（import kernel dist 后）。
 * 返回 WrapperContext；失败抛 KernelError。
 */
export function startNapuketto(options: StartNapukettoOptions): WrapperContext {
    const { env, engineConfig, sessionConfig, wrapperExports, qqSession, qqLoginService } = options;
    const versionInfo: QQVersionContext = {
        fullVersion: env?.qqVersion ?? "",
        buildVersion: env?.qqVersion ?? "",
    };
    const ctx = createWrapper(wrapperExports, versionInfo);
    initEngine(ctx, engineConfig ?? defaultEngineConfig(env ?? {}));

    // 优先使用 QQ 已 init 的 session（拦截 new 捕获）
    if (qqSession !== undefined && qqSession !== null) {
        ctx.session = qqSession;
        ctx.loginService = qqLoginService ?? null;
    } else {
        const main = getMainSession(ctx);
        if (main === null) {
            createSession(ctx);
        }
    }

    if (sessionConfig !== undefined) {
        initSession(ctx, sessionConfig, createBootListener());
        startSession(ctx);
    }
    return ctx;
}

/** startNapuketto 的引导环境（由 loader launcher 注入环境变量，boot.cjs 透传）。 */
export interface BootEnv {
    /** QQ 版本（如 "9.9.31-49919"）。 */
    qqVersion?: string;
    /** 用户数据目录（cfgDir 的父级，用于 desktopPathConfig）。 */
    dataDir?: string;
    /** 账号 uin（可选，提供则一步 init+start）。 */
    selfUin?: string;
    /** 账号 uid（可选）。 */
    selfUid?: string;
}

/** startNapuketto 选项。 */
export interface StartNapukettoOptions {
    /** 截获的 wrapper.node NAPI exports（boot.cjs 传入）。 */
    wrapperExports: WrapperNodeApi;
    /** 引导环境（版本/数据目录/账号）。 */
    env?: BootEnv;
    /** 覆盖 engine 配置（联调用）。 */
    engineConfig?: EnginInitDesktopConfig;
    /** 覆盖 session 配置（联调用，提供则自动 init+start）。 */
    sessionConfig?: WrapperSessionInitConfig;
    /** QQ 已 init 的 session（boot.cjs 拦截 new 捕获，NapCat 机制）。 */
    qqSession?: NodeIQQNTWrapperSession | null;
    /** QQ 的 loginService 实例（boot.cjs 拦截 new 捕获）。 */
    qqLoginService?: unknown;
}
