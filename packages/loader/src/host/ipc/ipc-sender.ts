/**
 * ipc-sender.ts：IPC 消息发送封装（self-host 子进程 → koishi 插件）。
 *
 * 仅 NAPUTO_IPC=1 启用：stdout 专用于 JSON 行协议（stdin 收 action/control）。
 * 非 IPC 模式（cli pnpm start）stdout 不输出协议行，零干扰。
 */
import {
    IPC_VERSION,
    type IpcBootPhase,
    type IpcLogLevel,
    type IpcMessage,
    type IpcResultPayload,
} from "./ipc-types.js";

/** IPC 模式开关（self-host.ts 在 env.NAPUTO_IPC=1 时 enable）。 */
let enabled = false;

/** 启用 IPC 发送（幂等）。 */
export function enableIpc(): void {
    enabled = true;
}

/** 是否启用。 */
export function isIpcEnabled(): boolean {
    return enabled;
}

/** 发送一条 IPC 消息（JSON 行）。失败静默（不阻塞引导）。 */
export function sendIpc(message: IpcMessage): void {
    if (!enabled) {
        return;
    }
    try {
        process.stdout.write(`${JSON.stringify(message)}\n`);
    } catch {
        // ignore：stdout 不可写不阻塞引导（崩溃堆栈仍走 stderr）
    }
}

/** 引导状态（booting/dlopening/logging/sessioning/ready/failed）。 */
export function sendStatus(
    phase: IpcBootPhase,
    message?: string,
    error?: { code: string; message: string },
): void {
    sendIpc({
        v: IPC_VERSION,
        type: "status",
        payload: {
            phase,
            ...(message !== undefined ? { message } : {}),
            ...(error !== undefined ? { error } : {}),
        },
    });
}

/** 登录状态（QR 状态机 idle/waiting_scan/scanned/logged_in/failed）。 */
export function sendLogin(
    state: "idle" | "waiting_scan" | "scanned" | "logged_in" | "failed",
    selfInfo?: { uin: string; uid: string; nick: string },
): void {
    sendIpc({
        v: IPC_VERSION,
        type: "login",
        payload: { state, ...(selfInfo !== undefined ? { selfInfo } : {}) },
    });
}

/** 二维码数据（扫码登录展示用）。 */
export function sendQr(pngBase64: string, qrcodeUrl: string): void {
    sendIpc({ v: IPC_VERSION, type: "qr", payload: { pngBase64, qrcodeUrl } });
}

/** kernel 事件转发（service/name/args 原样透传，koishi 插件翻译层消费）。 */
export function sendEvent(service: string, name: string, args: unknown[]): void {
    sendIpc({ v: IPC_VERSION, type: "event", payload: { service, name, args } });
}

/** 结构化日志转发（pino level）。 */
export function sendLog(level: IpcLogLevel, message: string): void {
    sendIpc({ v: IPC_VERSION, type: "log", payload: { level, message } });
}

/** 动作响应。 */
export function sendResult(id: number, payload: IpcResultPayload): void {
    sendIpc({ v: IPC_VERSION, type: "result", id, payload });
}

/** 心跳应答（收到 ping 时回）。 */
export function sendPong(): void {
    sendIpc({ v: IPC_VERSION, type: "pong" });
}

/** 心跳（定期发送，koishi 插件探活）。 */
export function sendPing(): void {
    sendIpc({ v: IPC_VERSION, type: "ping" });
}
