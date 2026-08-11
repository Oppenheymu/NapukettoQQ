/**
 * ipc-actions.ts：IPC 动作表（koishi 动作 → kernel API）。
 *
 * 协议契约：动作名点分域（`msg.sendMessage` 等），params 宽松透传。
 * 本轮实现 koishi Bot 核心动作（发消息/撤回/历史/已读/列表/self）；
 * 其余动作随 koishi 插件 actions.ts 轮次按需扩充。
 *
 * ⚠️ 不自研 kernel 依赖（loader 运行时 file:// 动态 import kernel，编译期不建
 * workspace 依赖——见 types.ts 注释）。错误码提取用宽松结构判断。
 */
import { log } from "../util.js";

/** 宽松 Peer 最小面（kernel Peer：chatType + peerUid）。 */
export interface IpcPeer {
    chatType: number;
    peerUid: string;
}

/** kernel apis 最小面（仅本表用到的成员；真实实例由引导装配提供）。 */
export interface IpcApiContext {
    msgApi: {
        sendMessage(target: IpcPeer, elements: unknown[]): Promise<{ msgId: string }>;
        recallMessage(target: IpcPeer, msgIds: string[]): Promise<void>;
        fetchMessages(target: IpcPeer, opts: { count: number; msgId?: string }): Promise<unknown[]>;
        markRead(target: IpcPeer): Promise<void>;
    };
    groupApi: {
        /** 触发原生群列表刷新（数据经 onGroupListUpdate 事件推送，返回值无数据）。 */
        getGroupList(force?: boolean): Promise<unknown[]>;
    };
    /** 群缓存（事件维护群列表；listGroupsRefreshed 空缓存时主动刷新等待回填）。 */
    groupCache: {
        listGroupsRefreshed(): Promise<Array<{ groupCode: string; groupName: string }>>;
    };
    friendApi: {
        getFriendList(): Promise<unknown[]>;
    };
    /** 登录账号自身信息。 */
    self: { uin: string; nickname: string };
    /** uin → uid 转换（Peer 目标解析；注入 groupApi.uinToUid）。 */
    uinToUid?: (uins: string[]) => Promise<Map<string, string>>;
    /** wrapper session（诊断用：枚举/触发原生服务方法面，验证初始化链路）。 */
    session?: unknown;
    /** wrapper engine（诊断用：initLog 等初始化方法验证）。 */
    engine?: unknown;
    /** NodeQQNTWrapperUtil（诊断用：原生 copyFile 验证富媒体文件放置）。 */
    util?: unknown;
}

/** 动作处理函数：params 宽松透传，返回值原样序列化（JSON 可序列化）。 */
export type IpcActionHandler = (params: Record<string, unknown>) => Promise<unknown>;

/**
 * 从宽松 params 构造 Peer（缺省 chatType=1 群聊）。
 * 优先 peerUid（uid 直通）；缺省时 peerUin 经 uinToUid 转换。
 *
 * ⚠️ 2026-08-09 修复：群聊（chatType=2）peerUid 直接用群号（kernel Peer 定义
 * 「群号 / 用户 uid」，OB11 resolve-peer 同构），**不走 uinToUid**——
 * getUidByUins 是「用户 uin → uid」转换，传群号属非法调用（QQ 原生内部
 * 抛 `Cannot read properties of undefined (reading 'service')`，实测）。
 */
async function toPeer(
    params: Record<string, unknown>,
    uinToUid: IpcApiContext["uinToUid"],
): Promise<IpcPeer> {
    const chatType = typeof params["chatType"] === "number" ? params["chatType"] : 1;
    const uidParam = params["peerUid"];
    if (typeof uidParam === "string" && uidParam !== "") {
        return { chatType, peerUid: uidParam };
    }
    const uinParam = params["peerUin"];
    if (typeof uinParam === "string" && uinParam !== "") {
        if (chatType === 2) {
            return { chatType, peerUid: uinParam };
        }
        if (uinToUid !== undefined) {
            const map = await uinToUid([uinParam]);
            const uid = map.get(uinParam);
            if (uid !== undefined && uid !== "") {
                return { chatType, peerUid: uid };
            }
            throw new Error(`uin 转 uid 失败: ${uinParam}`);
        }
        throw new Error("缺 peerUid（或 peerUin 且未注入 uinToUid）");
    }
    throw new Error("缺 peerUid（或 peerUin 且未注入 uinToUid）");
}

/** 构造动作表（map 顺序即注册顺序，重复动作名后注册覆盖）。 */
export function createIpcActions(ctx: IpcApiContext): Map<string, IpcActionHandler> {
    const actions = new Map<string, IpcActionHandler>();

    actions.set("login.getSelf", async () => ctx.self);

    actions.set("msg.sendMessage", async (params) => {
        const peer = await toPeer(params, ctx.uinToUid);
        const elements = Array.isArray(params["elements"]) ? params["elements"] : [];
        return ctx.msgApi.sendMessage(peer, elements);
    });

    actions.set("msg.recallMessage", async (params) => {
        const peer = await toPeer(params, ctx.uinToUid);
        const msgIds = Array.isArray(params["msgIds"]) ? params["msgIds"].map(String) : [];
        await ctx.msgApi.recallMessage(peer, msgIds);
    });

    actions.set("msg.fetchMessages", async (params) => {
        const peer = await toPeer(params, ctx.uinToUid);
        const count = typeof params["count"] === "number" ? params["count"] : 20;
        const msgId = typeof params["msgId"] === "string" ? params["msgId"] : undefined;
        return ctx.msgApi.fetchMessages(peer, { count, ...(msgId !== undefined ? { msgId } : {}) });
    });

    actions.set("msg.markRead", async (params) => {
        const peer = await toPeer(params, ctx.uinToUid);
        await ctx.msgApi.markRead(peer);
    });

    actions.set("group.getGroupList", async () => {
        // 群列表数据唯一来源：GroupCache（实测原生 getGroupList 返回值无数据，
        // 列表经 onGroupListUpdate 事件推送；缓存为空时内部触发刷新等待回填）
        return ctx.groupCache.listGroupsRefreshed();
    });

    actions.set("friend.getFriendList", async () => ctx.friendApi.getFriendList());

    // ── 诊断动作（2026-08-11 重建：调查 rich media transfer failed）──
    // 枚举富媒体/闪传服务方法面 + 调用候选 side-effect 方法，
    // 观察 wrapper 日志是否出现 FlashTransferUploadManager Init / AllocDedicatedThread sucess。
    actions.set("diag.richMediaTmpPaths", async () => runRichMediaDiag(ctx.session));

    // 诊断：按方法名 + 参数数组调用 flash 服务任意方法（2 参数组合实验用）。
    actions.set("diag.flashCall", async (params) => {
        const sess = ctx.session as { getFlashTransferService?: () => unknown } | undefined;
        if (sess === undefined) {
            return { error: "session 未注入" };
        }
        const flash =
            typeof sess.getFlashTransferService === "function"
                ? sess.getFlashTransferService()
                : null;
        if (flash === null || flash === undefined) {
            return { error: "flash 服务为 null" };
        }
        return callDiagnosticMethod(flash, params);
    });

    // 诊断：调用 session 任意方法（上线信号验证：onLine 可能触发模块初始化）。
    actions.set("diag.sessionCall", async (params) => {
        if (ctx.session === undefined) {
            return { error: "session 未注入" };
        }
        return callDiagnosticMethod(ctx.session, params);
    });

    // 诊断：调用 engine 任意方法 + 枚举方法面（initLog 等初始化方法验证）。
    actions.set("diag.engineCall", async (params) => {
        if (ctx.engine === undefined) {
            return { error: "engine 未注入" };
        }
        return callDiagnosticMethod(ctx.engine, params);
    });

    // 诊断：调用 richMediaService 任意方法（uploadRMFileWithoutMsg 等替代上传路径）。
    actions.set("diag.richMediaCall", async (params) => {
        const sess = ctx.session as { getRichMediaService?: () => unknown } | undefined;
        if (sess === undefined) {
            return { error: "session 未注入" };
        }
        const svc =
            typeof sess.getRichMediaService === "function" ? sess.getRichMediaService() : null;
        if (svc === null || svc === undefined) {
            return { error: "richMedia 服务为 null" };
        }
        return callDiagnosticMethod(svc, params);
    });

    // 诊断：调用 msgService 任意方法（getRichMediaFilePathForGuild 等富媒体路径计算）。
    actions.set("diag.msgServiceCall", async (params) => {
        const sess = ctx.session as { getMsgService?: () => unknown } | undefined;
        if (sess === undefined) {
            return { error: "session 未注入" };
        }
        const svc = typeof sess.getMsgService === "function" ? sess.getMsgService() : null;
        if (svc === null || svc === undefined) {
            return { error: "msgService 为 null" };
        }
        return callDiagnosticMethod(svc, params);
    });

    // 诊断：调用 NodeQQNTWrapperUtil 任意方法（原生 copyFile 等）。
    actions.set("diag.utilCall", async (params) => {
        const util = ctx.util as { get?: () => unknown } | undefined;
        if (util === undefined) {
            return { error: "util 未注入" };
        }
        const instance = typeof util.get === "function" ? util.get() : util;
        if (instance === null || instance === undefined) {
            return { error: "util 实例为 null" };
        }
        return callDiagnosticMethod(instance, params);
    });

    return actions;
}

/** 诊断：按方法名 + 参数数组调用对象任意方法（返回结构化结果，不抛）。 */
async function callDiagnosticMethod(
    obj: unknown,
    params: Record<string, unknown>,
): Promise<unknown> {
    const method = typeof params["method"] === "string" ? params["method"] : "";
    const args = Array.isArray(params["args"]) ? params["args"] : [];
    const target = obj as Record<string, unknown>;
    if (method === "__methods") {
        return { methods: Object.getOwnPropertyNames(Object.getPrototypeOf(obj)) };
    }
    const fn = target[method];
    if (typeof fn !== "function") {
        return { error: `方法不存在: ${method}` };
    }
    try {
        const r = await (fn as (...a: unknown[]) => unknown).apply(obj, args);
        return { ok: true, ret: r };
    } catch (e) {
        return { ok: false, err: e instanceof Error ? e.message : String(e) };
    }
}

/** 诊断：枚举富媒体临时路径（getPicTmpPath 等 0 参方法）。 */
async function enumerateTmpPaths(svc: unknown): Promise<Record<string, unknown>> {
    const tmp: Record<string, unknown> = {};
    for (const name of [
        "getPicTmpPath",
        "getRichMeidaTmpPath",
        "getPttTmpPath",
        "getVideoTmpPath",
        "getFileTmpPath",
        "getTransferingTmpPath",
    ]) {
        const fn = (svc as Record<string, unknown>)[name];
        if (typeof fn === "function") {
            try {
                tmp[name] = await (fn as () => unknown).call(svc);
            } catch (e) {
                tmp[name] = `调用失败: ${e instanceof Error ? e.message : String(e)}`;
            }
        } else {
            tmp[name] = "方法缺失";
        }
    }
    return tmp;
}

/** 诊断：闪传服务候选 side-effect 触发（§5.3 候选动作 1，参数宽松猜测）。 */
async function probeFlashSideEffects(flash: unknown): Promise<Record<string, unknown>> {
    const flashObj = flash as Record<string, unknown>;
    const sideEffects: Record<string, unknown> = {};
    const candidates: [string, unknown[]][] = [
        ["addFileSetSimpleStatusListener", [() => undefined]],
        ["setFlashTransferDir", [""]],
        ["setFileSetDownloadDir", [""]],
        ["getFileSetIdByCode", [""]],
    ];
    for (const [name, args] of candidates) {
        const fn = flashObj[name];
        if (typeof fn === "function") {
            try {
                const r = await (fn as (...a: unknown[]) => unknown).apply(flash, args);
                sideEffects[name] = { ok: true, ret: r };
            } catch (e) {
                sideEffects[name] = {
                    ok: false,
                    err: e instanceof Error ? e.message : String(e),
                };
            }
        } else {
            sideEffects[name] = { missing: true };
        }
    }
    return sideEffects;
}

/** 诊断主流程：session → 富媒体服务 + 闪传服务的方法面与触发结果。 */
async function runRichMediaDiag(session: unknown): Promise<Record<string, unknown>> {
    const sess = session as
        | { getRichMediaService?: () => unknown; getFlashTransferService?: () => unknown }
        | undefined;
    if (sess === undefined) {
        return { error: "session 未注入（IPC 上下文缺 session）" };
    }
    const out: Record<string, unknown> = {};
    const svc = typeof sess.getRichMediaService === "function" ? sess.getRichMediaService() : null;
    if (svc !== null && svc !== undefined) {
        out["richMediaTmpPaths"] = await enumerateTmpPaths(svc);
        out["richMediaMethods"] = Object.getOwnPropertyNames(Object.getPrototypeOf(svc));
    } else {
        out["richMediaService"] = "null";
    }
    const flash =
        typeof sess.getFlashTransferService === "function" ? sess.getFlashTransferService() : null;
    if (flash !== null && flash !== undefined) {
        out["flashMethods"] = Object.getOwnPropertyNames(Object.getPrototypeOf(flash));
        out["flashSideEffects"] = await probeFlashSideEffects(flash);
    } else {
        out["flashService"] = "null";
    }
    return out;
}

/** 统一动作调用：查找动作表 → 执行 → 返回结果或错误（不抛，调用方转 result）。 */
export async function callIpcAction(
    actions: Map<string, IpcActionHandler>,
    action: string,
    params: Record<string, unknown> | undefined,
): Promise<
    { ok: true; value?: unknown } | { ok: false; error: { code: string; message: string } }
> {
    const handler = actions.get(action);
    if (handler === undefined) {
        return { ok: false, error: { code: "NOT_FOUND", message: `未知动作: ${action}` } };
    }
    try {
        const value = await handler(params ?? {});
        return { ok: true, value };
    } catch (err) {
        // 诊断（2026-08-09）：错误消息传回 koishi 会丢堆栈，先落 boot 日志
        // 便于定位真实错误位置（QQ 原生内部抛错时消息难以反查）。
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error && err.stack !== undefined ? err.stack : "";
        log(`[ipc] action=${action} 失败: ${message}\n${stack}`);
        return { ok: false, error: { code: errorCodeOf(err), message } };
    }
}

/** 宽松提取错误码（KernelError 有 string code 字段；其他错误 UNKNOWN）。 */
function errorCodeOf(err: unknown): string {
    if (typeof err === "object" && err !== null) {
        const code = (err as { code?: unknown }).code;
        if (typeof code === "string" && code !== "") {
            return code;
        }
    }
    return "UNKNOWN";
}
