/**
 * ipc-bootstrap.ts：IPC 模式装配（bootstrap-core 调用）。
 *
 * 职责：启用发送 → 建动作表 → 启动 stdin 服务端 → kernel 事件通道转发
 * （onAny → event 消息）。返回停止函数（进程退出时清理）。
 */
import type { KernelServices } from "../core/kernel-services.js";
import { createIpcActions, type IpcApiContext } from "./ipc-actions.js";
import { enableIpc, sendEvent } from "./ipc-sender.js";
import { startIpcServer } from "./ipc-server.js";

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

/** IPC 模式装配（enableIpc + 动作表 + 服务端 + 事件转发）。返回停止函数。 */
export function startIpcMode(services: KernelServices): () => void {
    enableIpc();
    // peerUin（QQ 号）→ uid 转换（kernel GroupApi.uinToUid，自研描述；
    // exactOptionalPropertyTypes：可选字段用条件展开，不显式赋 undefined）
    const groupApi = services.groupApi as {
        uinToUid?: (uins: string[]) => Promise<Map<string, string>>;
    };
    const actions = createIpcActions({
        msgApi: services.msgApi as IpcApiContext["msgApi"],
        groupApi: services.groupApi as IpcApiContext["groupApi"],
        groupCache: services.groupCache as IpcApiContext["groupCache"],
        friendApi: services.friendApi as IpcApiContext["friendApi"],
        self: services.self,
        ...(groupApi.uinToUid !== undefined ? { uinToUid: groupApi.uinToUid } : {}),
    });
    const stopServer = startIpcServer({ actions });

    const stops: Array<() => void> = [];
    forwardChannel(services.channel, stops);
    forwardChannel(services.groupChannel, stops);

    return () => {
        stopServer();
        for (const stop of stops) {
            stop();
        }
    };
}
