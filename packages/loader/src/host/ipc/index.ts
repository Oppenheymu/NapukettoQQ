/**
 * index.ts：IPC 协议层出口（self-host 子进程侧）。
 */
export {
    callIpcAction,
    createIpcActions,
    type IpcActionHandler,
    type IpcApiContext,
    type IpcPeer,
} from "./ipc-actions.js";
export { startIpcMode } from "./ipc-bootstrap.js";
export { decodeIpcMessage, encodeIpcMessage } from "./ipc-codec.js";
export {
    enableIpc,
    isIpcEnabled,
    sendEvent,
    sendIpc,
    sendLog,
    sendLogin,
    sendPing,
    sendPong,
    sendQr,
    sendResult,
    sendStatus,
} from "./ipc-sender.js";
export {
    HEARTBEAT_INTERVAL_MS,
    type IpcServerOptions,
    startIpcServer,
} from "./ipc-server.js";
export {
    IPC_MESSAGE_TYPES,
    IPC_VERSION,
    type IpcActionMessage,
    type IpcActionPayload,
    type IpcBootPhase,
    type IpcControlMessage,
    type IpcControlPayload,
    type IpcEventMessage,
    type IpcEventPayload,
    type IpcLoginMessage,
    type IpcLoginPayload,
    type IpcLogLevel,
    type IpcLogMessage,
    type IpcLogPayload,
    type IpcMessage,
    type IpcPingMessage,
    type IpcPongMessage,
    type IpcQrMessage,
    type IpcResultMessage,
    type IpcResultPayload,
    type IpcStatusMessage,
    type IpcStatusPayload,
} from "./ipc-types.js";
