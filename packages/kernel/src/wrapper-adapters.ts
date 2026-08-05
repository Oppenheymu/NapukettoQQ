/**
 * wrapper NAPI 回调适配器实现（普通 JS 对象，2026-08-05 确认）
 *
 * 事实（实测）：wrapper.node 的 exports 89 键里没有 NodeI*Adapter/Listener 构造器，
 * engine.initWithDeskTopConfig / session.init 的 adapter 与 listener 参数一律接受
 * **普通 JS 对象**——NAPI 按方法名反射读取回调。NapCat 同款机制（自研实现，零复制）。
 *
 * 职责：engine / session 交互所需的全部回调占位与监听器工厂。
 *  - GlobalAdapter     → engine.initWithDeskTopConfig 第二参（onLog / getAppSetting / ...）
 *  - DependsAdapter    → session.init 第二参（onMSFStatusChange / onMSFSsoError / getGroupCode）
 *  - DispatcherAdapter → session.init 第三参（dispatchRequest / dispatchCall / dispatchCallWithJson）
 *  - createSessionListener → 日志版 session 监听器（boot 阶段默认，login 模块可覆盖）
 *  - createLoginListener   → 登录监听器占位（登录器接入时填充）
 *
 * 这些类的实例本身就是「普通 JS 对象」，可被 NAPI 反射——直接 new 传入即可。
 */

import process from "node:process";
import type {
    IKernelLoginListener,
    NodeIDependsAdapter,
    NodeIDispatcherAdapter,
    NodeIGlobalAdapter,
    NodeIKernelSessionListener,
} from "./types/wrapper.js";

/** NAPI 回调占位（方法存在即可被反射调用，无副作用）。 */
const noop = (): void => undefined;

/** NodeIGlobalAdapter 实现（engine.initWithDeskTopConfig 第二参）。 */
export class GlobalAdapter implements NodeIGlobalAdapter {
    onLog = noop;
    onGetSrvCalTime = noop;
    onShowErrUITips = noop;
    fixPicImgType = noop;
    getAppSetting = noop;
    onInstallFinished = noop;
    onUpdateGeneralFlag = noop;
    onGetOfflineMsg = noop;
}

/** NodeIDependsAdapter 实现（session.init 第二参）。 */
export class DependsAdapter implements NodeIDependsAdapter {
    onMSFStatusChange = noop;
    onMSFSsoError = noop;
    getGroupCode = noop;
}

/** NodeIDispatcherAdapter 实现（session.init 第三参）。 */
export class DispatcherAdapter implements NodeIDispatcherAdapter {
    dispatchRequest = noop;
    dispatchCall = noop;
    dispatchCallWithJson = noop;
}

/** 创建会话监听器（日志版，boot 阶段默认；login 模块接入后可覆盖）。 */
export function createSessionListener(prefix = "[napuketto:session]"): NodeIKernelSessionListener {
    const log = (msg: string, ...rest: unknown[]): void => {
        process.stdout.write(`${prefix} ${msg} ${rest.map(String).join(" ")}\n`);
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

/** 创建登录监听器（占位，登录器接入时填充）。 */
export function createLoginListener(): IKernelLoginListener {
    return {};
}
