/**
 * ipc-bootstrap.ts：IPC 模式装配（bootstrap-core 调用）。
 *
 * 职责：登录前创建登录期动作表（login.refreshQr 可达）+ 启动 stdin 服务端；
 * 登录后把 kernel 服务动作并入同一张表 + 事件通道转发（onAny → event 消息）。
 * 返回停止函数（进程退出时清理）。
 */

import type { KernelServices } from "../core/kernel-services.js";
import type { CoreLike } from "../types.js";
import {
    createIpcActions,
    type IpcActionHandler,
    type IpcApiContext,
    registerLoginRefreshAction,
} from "./ipc-actions.js";
import { sendEvent } from "./ipc-sender.js";

/** 订阅事件通道 → event 消息转发（事件名 "Service/method" 拆分）。 */
function forwardChannel(channel: KernelServices["channel"], stops: Array<() => void>): void {
    if (typeof channel.onAny !== "function") {
        return;
    }
    const off = channel.onAny((event, ...args) => {
        const slash = event.indexOf("/");
        const service = slash >= 0 ? event.slice(0, slash) : event;
        const name = slash >= 0 ? event.slice(slash + 1) : "";
        sendEvent(service, name, args);
    });
    // 宽松返回面（EventChannelLike.onAny 返回 unknown）：是函数才收进停止列表
    if (typeof off === "function") {
        stops.push(off as () => void);
    }
}

/**
 * 登录期动作表：只含 login.refreshQr（依赖 core.refreshQr，不依赖 session 服务）。
 * bootstrap-core 在登录前用它启动 IPC 服务端——登录中前端即可刷新二维码。
 */
export function createIpcActionsForCore(core: CoreLike): Map<string, IpcActionHandler> {
    const actions = new Map<string, IpcActionHandler>();
    if (typeof core.refreshQr === "function") {
        registerLoginRefreshAction(actions, () => core.refreshQr?.() ?? false);
    }
    return actions;
}

/**
 * 把 kernel 服务动作并入共享动作表 + 事件通道转发（登录成功后调用）。
 * 返回停止函数（清理事件转发订阅；stdin 服务端由 bootstrap-core 独立管理）。
 */
export function attachIpcServices(
    actions: Map<string, IpcActionHandler>,
    services: KernelServices,
): () => void {
    // peerUin（QQ 号）→ uid 转换（kernel GroupApi.uinToUid，自研描述；
    // exactOptionalPropertyTypes：可选字段用条件展开，不显式赋 undefined）
    const groupApi = services.groupApi as {
        uinToUid?: (uins: string[]) => Promise<Map<string, string>>;
    };
    const full = createIpcActions({
        msgApi: services.msgApi as IpcApiContext["msgApi"],
        groupApi: services.groupApi as IpcApiContext["groupApi"],
        groupCache: services.groupCache as IpcApiContext["groupCache"],
        friendApi: services.friendApi as IpcApiContext["friendApi"],
        self: services.self,
        session: services.session,
        engine: services.engine,
        util: services.util,
        ...(groupApi.uinToUid !== undefined ? { uinToUid: groupApi.uinToUid } : {}),
    });
    for (const [name, handler] of full) {
        actions.set(name, handler);
    }

    const stops: Array<() => void> = [];
    forwardChannel(services.channel, stops);
    forwardChannel(services.groupChannel, stops);

    return () => {
        for (const stop of stops) {
            stop();
        }
    };
}
