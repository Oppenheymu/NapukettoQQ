/**
 * ipc-server.ts：IPC 服务端（self-host 子进程侧）。
 *
 * 职责（design.md §5.6 / §7）：
 *  - stdin readline 收 action / control / ping
 *  - action → 动作表执行 → result 响应（请求 id 匹配）
 *  - control stop/restart → 退出回调（默认 process.exit(0)，由驱动层重启）
 *  - ping → 自动回 pong
 *  - 心跳：定期发 ping（koishi 插件探活）
 */
import { createInterface } from "node:readline";
import { callIpcAction, type IpcActionHandler } from "./ipc-actions.js";
import { decodeIpcMessage } from "./ipc-codec.js";
import { sendPing, sendPong, sendResult } from "./ipc-sender.js";
import type { IpcControlPayload } from "./ipc-types.js";

/** 心跳间隔（毫秒）。 */
const HEARTBEAT_INTERVAL_MS = 15_000;

/** IPC 服务端选项。 */
export interface IpcServerOptions {
    /** 动作表（createIpcActions 产物）。 */
    actions: Map<string, IpcActionHandler>;
    /** 心跳间隔（毫秒，默认 15s）。 */
    heartbeatMs?: number;
    /** control stop/restart 退出回调（默认 process.exit(0)，由驱动层重启）。 */
    onExit?: () => void;
}

/** 启动 IPC 服务端（stdin 接收 + 心跳）。返回停止函数。 */
export function startIpcServer(options: IpcServerOptions): () => void {
    const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
    const onExit = options.onExit ?? (() => process.exit(0));

    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.on("line", (line) => {
        const message = decodeIpcMessage(line);
        if (message === null) {
            return; // 非法行：忽略（协议健壮性）
        }
        switch (message.type) {
            case "action":
                void handleAction(
                    message.id,
                    message.payload.action,
                    message.payload.params,
                    options.actions,
                );
                break;
            case "control":
                handleControl(message.payload, onExit);
                break;
            case "ping":
                sendPong();
                break;
            default:
                break;
        }
    });

    // 心跳：定期发 ping（koishi 插件据此判断失联）
    const timer = setInterval(() => sendPing(), heartbeatMs);

    return () => {
        clearInterval(timer);
        rl.close();
    };
}

/** 动作执行 → result 响应（不抛：callIpcAction 内部兜底转错误）。 */
async function handleAction(
    id: number,
    action: string,
    params: Record<string, unknown> | undefined,
    actions: Map<string, IpcActionHandler>,
): Promise<void> {
    const result = await callIpcAction(actions, action, params);
    sendResult(id, result);
}

/** 控制指令处理（stop/restart 退出；login 预留——引导期登录由 bootstrap 内部驱动）。 */
function handleControl(payload: IpcControlPayload, onExit: () => void): void {
    if (payload.command === "stop" || payload.command === "restart") {
        onExit();
    }
    // login 控制指令：本轮预留（引导期登录在 bootstrap 内完成）
}
