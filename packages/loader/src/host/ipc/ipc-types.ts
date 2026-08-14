/**
 * ipc-types.ts：IPC 协议消息（koishi 插件 ↔ self-host 子进程，单一来源）。
 *
 * 协议契约（koishi 插件 design.md §5.6）：`{ v, type, id?, payload }` JSON 行。
 * 用 zod v4 定义单一 schema，两侧（loader host + koishi 插件）import 同一份：
 * 类型经 z.infer 派生、运行时经 safeParse 校验，消除「两份手写 types.ts」漂移。
 *
 * 领域字段（LoginState / SelfInfo / QrCodeData）与 kernel 同名类型结构等价，
 * 在协议边界内联为 zod schema（kernel 不依赖 zod，故不在 kernel 定义）。
 */
import { z } from "zod";

/** IPC 协议版本（解码校验）。 */
export const IPC_VERSION = 1;

/** 引导阶段（status 消息）。 */
export const IpcBootPhaseSchema = z.enum([
    "booting", // 子进程已启动（spawn 成功）
    "dlopening", // dlopen wrapper.node
    "logging", // 登录流程进行中
    "sessioning", // session 初始化中
    "ready", // session READY + 业务 service 装配完成
    "failed", // 引导失败（携带错误）
]);

/** 结构化日志级别（pino level）。 */
export const IpcLogLevelSchema = z.enum(["trace", "debug", "info", "warn", "error", "fatal"]);

/** 登录状态（与 kernel LoginState 结构等价）。 */
const LoginStateSchema = z.enum(["idle", "waiting_scan", "scanned", "logged_in", "failed"]);

/** selfInfo（与 kernel SelfInfo 结构等价）。 */
const SelfInfoSchema = z.object({
    uin: z.string(),
    uid: z.string(),
    nick: z.string(),
});

/** status 消息 payload。 */
export const IpcStatusPayloadSchema = z.object({
    phase: IpcBootPhaseSchema,
    message: z.string().optional(),
    error: z.object({ code: z.string(), message: z.string() }).optional(),
});

/** login 消息 payload。 */
export const IpcLoginPayloadSchema = z.object({
    state: LoginStateSchema,
    selfInfo: SelfInfoSchema.optional(),
    /** 失败原因（state=failed 时；如「登录超时，请刷新页面重试」）。 */
    message: z.string().optional(),
});

/** event 消息 payload（kernel 事件通道形状，翻译层按 service/name 断言具体类型）。 */
export const IpcEventPayloadSchema = z.object({
    service: z.string(),
    name: z.string(),
    args: z.array(z.unknown()),
});

/** log 消息 payload。 */
export const IpcLogPayloadSchema = z.object({
    level: IpcLogLevelSchema,
    message: z.string(),
});

/** 动作响应 payload（result 消息）。 */
export const IpcResultPayloadSchema = z.union([
    z.object({ ok: z.literal(true), value: z.unknown().optional() }),
    z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);

/** 动作请求 payload（action 消息）。 */
export const IpcActionPayloadSchema = z.object({
    action: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
});

/** 控制指令 payload（control 消息，父→子）。 */
export const IpcControlPayloadSchema = z.union([
    z.object({ command: z.literal("stop") }), // 优雅退出
    z.object({ command: z.literal("restart") }), // 退出并期望驱动层重启
    z.object({
        command: z.literal("login"),
        uin: z.string().optional(),
        qr: z.boolean().optional(),
    }), // 触发登录（预留）
]);

// ── 消息联合 ──

const IpcStatusMessageSchema = z.object({
    v: z.literal(IPC_VERSION),
    type: z.literal("status"),
    payload: IpcStatusPayloadSchema,
});

const IpcLoginMessageSchema = z.object({
    v: z.literal(IPC_VERSION),
    type: z.literal("login"),
    payload: IpcLoginPayloadSchema,
});

const IpcQrMessageSchema = z.object({
    v: z.literal(IPC_VERSION),
    type: z.literal("qr"),
    payload: z.object({ pngBase64: z.string(), qrcodeUrl: z.string() }),
});

const IpcEventMessageSchema = z.object({
    v: z.literal(IPC_VERSION),
    type: z.literal("event"),
    payload: IpcEventPayloadSchema,
});

const IpcResultMessageSchema = z.object({
    v: z.literal(IPC_VERSION),
    type: z.literal("result"),
    id: z.number(),
    payload: IpcResultPayloadSchema,
});

const IpcLogMessageSchema = z.object({
    v: z.literal(IPC_VERSION),
    type: z.literal("log"),
    payload: IpcLogPayloadSchema,
});

const IpcPingMessageSchema = z.object({
    v: z.literal(IPC_VERSION),
    type: z.literal("ping"),
});

const IpcPongMessageSchema = z.object({
    v: z.literal(IPC_VERSION),
    type: z.literal("pong"),
});

const IpcActionMessageSchema = z.object({
    v: z.literal(IPC_VERSION),
    type: z.literal("action"),
    id: z.number(),
    payload: IpcActionPayloadSchema,
});

const IpcControlMessageSchema = z.object({
    v: z.literal(IPC_VERSION),
    type: z.literal("control"),
    payload: IpcControlPayloadSchema,
});

/** IPC 消息判别联合（协议边界，运行时经 safeParse 校验）。 */
export const IpcMessageSchema = z.discriminatedUnion("type", [
    IpcStatusMessageSchema,
    IpcLoginMessageSchema,
    IpcQrMessageSchema,
    IpcEventMessageSchema,
    IpcResultMessageSchema,
    IpcLogMessageSchema,
    IpcPingMessageSchema,
    IpcPongMessageSchema,
    IpcActionMessageSchema,
    IpcControlMessageSchema,
]);

// ── 派生类型（z.infer，两侧消费同名类型，无镜像漂移） ──

export type IpcBootPhase = z.infer<typeof IpcBootPhaseSchema>;
export type IpcLogLevel = z.infer<typeof IpcLogLevelSchema>;
export type IpcStatusPayload = z.infer<typeof IpcStatusPayloadSchema>;
export type IpcLoginPayload = z.infer<typeof IpcLoginPayloadSchema>;
export type IpcEventPayload = z.infer<typeof IpcEventPayloadSchema>;
export type IpcLogPayload = z.infer<typeof IpcLogPayloadSchema>;
export type IpcResultPayload = z.infer<typeof IpcResultPayloadSchema>;
export type IpcActionPayload = z.infer<typeof IpcActionPayloadSchema>;
export type IpcControlPayload = z.infer<typeof IpcControlPayloadSchema>;
export type IpcStatusMessage = z.infer<typeof IpcStatusMessageSchema>;
export type IpcLoginMessage = z.infer<typeof IpcLoginMessageSchema>;
export type IpcQrMessage = z.infer<typeof IpcQrMessageSchema>;
export type IpcEventMessage = z.infer<typeof IpcEventMessageSchema>;
export type IpcResultMessage = z.infer<typeof IpcResultMessageSchema>;
export type IpcLogMessage = z.infer<typeof IpcLogMessageSchema>;
export type IpcPingMessage = z.infer<typeof IpcPingMessageSchema>;
export type IpcPongMessage = z.infer<typeof IpcPongMessageSchema>;
export type IpcActionMessage = z.infer<typeof IpcActionMessageSchema>;
export type IpcControlMessage = z.infer<typeof IpcControlMessageSchema>;
export type IpcMessage = z.infer<typeof IpcMessageSchema>;
