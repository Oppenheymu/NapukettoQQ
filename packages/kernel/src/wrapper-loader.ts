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

import { kernelError } from "./errors.js";
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

/** NodeIGlobalAdapter 空实现（engine.initWithDeskTopConfig 第二参）。 */
class GlobalAdapter implements NodeIGlobalAdapter {}

/** NodeIDependsAdapter 空实现（session.init 第二参）。 */
class DependsAdapter implements NodeIDependsAdapter {}

/** NodeIDispatcherAdapter 空实现（session.init 第三参）。 */
class DispatcherAdapter implements NodeIDispatcherAdapter {}

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
    /** 会话（createSession 后填充）。 */
    session: NodeIQQNTWrapperSession | null;
}

/**
 * 从 loader 截获的 NAPI exports 创建 wrapper 上下文。
 * 在 QQ 主进程内调用（boot.cjs → kernel 入口）。
 */
export function createWrapper(
    exports: WrapperNodeApi,
    versionInfo: QQVersionContext,
): WrapperContext {
    if (!exports || typeof exports.NodeIQQNTWrapperEngine !== "object") {
        throw kernelError(
            "wrapper.node exports 无效（缺少 NodeIQQNTWrapperEngine）",
            "INVALID_PARAM",
        );
    }
    if (typeof exports.NodeIQQNTWrapperEngine.get !== "function") {
        throw kernelError(
            "NodeIQQNTWrapperEngine.get 缺失（wrapper.node 未注册完整）",
            "INVALID_PARAM",
        );
    }
    const engine = exports.NodeIQQNTWrapperEngine.get();
    if (!engine || typeof engine.initWithDeskTopConfig !== "function") {
        throw kernelError("NodeIQQNTWrapperEngine.get() 返回对象无效", "INVALID_PARAM");
    }
    return { exports, engine, versionInfo, session: null };
}

/** engine 初始化（NapCat 语义：先 engine 后 session）。config 为普通 JS 对象。 */
export function initEngine(ctx: WrapperContext, config: EnginInitDesktopConfig): void {
    ctx.engine.initWithDeskTopConfig(config, new GlobalAdapter());
}

/** 创建会话：优先 startupSession.create()，失败回退 session.create()。 */
export function createSession(ctx: WrapperContext): NodeIQQNTWrapperSession {
    const S = ctx.exports.NodeIQQNTWrapperSession;
    const startup = ctx.exports.NodeIQQNTStartupSessionWrapper;
    let session: NodeIQQNTWrapperSession;
    try {
        if (typeof startup.create === "function") {
            session = startup.create() as unknown as NodeIQQNTWrapperSession;
        } else {
            session = S.create();
        }
    } catch {
        session = S.create();
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
