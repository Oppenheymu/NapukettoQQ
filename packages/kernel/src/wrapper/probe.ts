/**
 * 运行时反射探测（ADR-006 落地，P1-4）
 *
 * 注入链路打通后（2026-08-05），wrapper exports 是 QQ 已注册的单例。
 * 本模块在 **QQ 主进程内**反射枚举 session / service 的真实方法名与返回形状，
 * 产出 JSON 到 NAPUTO_CFG_DIR/napuketto-probe.json，作为 types/services/ 的权威来源。
 *
 * 用法：boot.cjs 在 NAPUTO_PROBE=1 时于 startNapuketto 后调用 probeRuntime(ctx)。
 * 产物是研究工具数据，类型层据此补全（自研描述，非移植）。
 *
 * 工具拆分（2026-08-08 FTA 优化）：方法枚举/安全调用 → probe-utils.ts；
 * 序列化/形状探测 → probe-serialize.ts；exports/service 探测 → probe-services.ts；
 * 本文件只留 session 探测编排（probeStartup/probeSession/probeRuntime）。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { serialize, shapeKeyGetters } from "./probe-serialize.js";
import { probeEngineCalls, probeExportCtors, probeLoginService } from "./probe-services.js";
import { listMethods, tryCall } from "./probe-utils.js";
import { getMainSession } from "./session-resolver.js";
import type { WrapperContext } from "./wrapper-loader.js";

/** 枚举候选 sessionId（nt_0..nt_9 / gpro_0..gpro_9）找 QQ 已 init 的 session。 */
function enumerateSessionIds(ctx: WrapperContext): Record<string, unknown> {
    const S = ctx.exports.NodeIQQNTWrapperSession;
    const enumFn = (S as unknown as Record<string, unknown>)["getNTWrapperSession"];
    const out: Record<string, unknown> = {};
    if (typeof enumFn !== "function") {
        return out;
    }
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) {
        ids.push(`nt_${i}`, `gpro_${i}`);
    }
    for (const id of ids) {
        try {
            const value = (enumFn as (...args: unknown[]) => unknown).call(S, id);
            if (!value) continue;
            const rec = value as Record<string, unknown>;
            // getter 存在性
            const hasGetter = typeof rec["getMsgService"] === "function";
            // 实际调用结果（关键：service 是否已 init）
            let msgService: unknown = null;
            let msgError: string | null = null;
            try {
                msgService = (rec["getMsgService"] as () => unknown).call(value);
            } catch (e) {
                msgError = e instanceof Error ? e.message : String(e);
            }
            out[id] = {
                hasMsgServiceGetter: hasGetter,
                msgServiceOk: msgService !== null && msgService !== undefined,
                msgServiceMethods: msgService ? listMethods(msgService).length : 0,
                msgError,
                methods: listMethods(value),
            };
        } catch {
            // 忽略单次失败
        }
    }
    return out;
}

/** 探测 startup 实例：start() + getSessionIdList()，提取 sessionIds（Map 值或键）。 */
function probeStartupChain(created: unknown): {
    start: Record<string, unknown>;
    createdGetSessionIdList: Record<string, unknown>;
    sessionIds: string[];
} {
    const started = tryCall(created, "start");
    const ids = tryCall(created, "getSessionIdList");
    const sessionIds: string[] = [];
    if (ids.ok && ids.value instanceof Map) {
        for (const [k, v] of ids.value) {
            const id = typeof v === "string" ? v : String(k);
            sessionIds.push(id);
        }
    }
    return {
        start: started.ok ? { ok: true } : { error: started.error },
        createdGetSessionIdList: ids.ok ? { value: serialize(ids.value) } : { error: ids.error },
        sessionIds,
    };
}

/** 用真实 sessionId 取主 session（getNTWrapperSession(nt_x)）并记录方法面。 */
function probeSessionById(ctx: WrapperContext, id: string): unknown {
    const S = ctx.exports.NodeIQQNTWrapperSession;
    const fn = (S as unknown as Record<string, unknown>)["getNTWrapperSession"];
    if (typeof fn !== "function") {
        return null;
    }
    try {
        const value = (fn as (...args: unknown[]) => unknown).call(S, id);
        return value
            ? { methods: listMethods(value), ownKeys: Object.getOwnPropertyNames(value) }
            : null;
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
}

/** 兜底：候选名字 getNTWrapperSession（无 Map 数据时）。 */
function probeByNameFallback(ctx: WrapperContext): Record<string, unknown> {
    const S = ctx.exports.NodeIQQNTWrapperSession;
    const candidates = ["main", "primary", "session1", "default", ""];
    const getResults: Record<string, unknown> = {};
    for (const name of candidates) {
        try {
            const fn = (S as unknown as Record<string, unknown>)["getNTWrapperSession"];
            const value =
                typeof fn === "function"
                    ? (fn as (...args: unknown[]) => unknown).call(S, name)
                    : null;
            getResults[name === "" ? "<empty>" : name] = value
                ? { methods: listMethods(value), ownKeys: Object.getOwnPropertyNames(value) }
                : null;
        } catch (e) {
            getResults[name === "" ? "<empty>" : name] = {
                error: e instanceof Error ? e.message : String(e),
            };
        }
    }
    return getResults;
}

/** 探测 startup session 链路：create() → start() → getSessionIdList → getNTWrapperSession。 */
function probeStartup(ctx: WrapperContext): Record<string, unknown> | null {
    const startup = ctx.exports.NodeIQQNTStartupSessionWrapper as unknown as {
        create?: () => unknown;
    } | null;
    if (startup === null || typeof startup.create !== "function") {
        return null;
    }
    const out: Record<string, unknown> = { staticMethods: listMethods(startup) };
    const created = tryCall(startup, "create");
    out["create"] = created.ok
        ? {
              methods: created.value ? listMethods(created.value) : [],
              value: serialize(created.value),
          }
        : { error: created.error };
    if (created.ok && created.value) {
        const chain = probeStartupChain(created.value);
        out["start"] = chain.start;
        out["createdGetSessionIdList"] = chain.createdGetSessionIdList;
        out["sessionIds"] = chain.sessionIds;
        // 用真实 sessionId 取主 session（格式 nt_<N> / gpro_<N>）
        const mainId = chain.sessionIds.find((id) => id.startsWith("nt_")) ?? chain.sessionIds[0];
        if (mainId !== undefined) {
            out["mainSessionId"] = mainId;
            out["mainSession"] = probeSessionById(ctx, mainId);
        }
    }
    out["enumSessionIds"] = enumerateSessionIds(ctx);
    // 无 Map 数据时兜底：候选名字
    if (out["sessionIds"] === undefined) {
        out["getNTWrapperSession"] = probeByNameFallback(ctx);
    }
    return out;
}

/** 探测 session 与 service 方法（优先复用 QQ 主 session）。 */
function probeSession(ctx: WrapperContext): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    let session: unknown = null;
    // 优先：startup → getSessionIdList → getNTWrapperSession（QQ 主 session）
    try {
        const main = getMainSession(ctx);
        if (main !== null) {
            session = main;
            out["sessionSource"] = "mainSession(getNTWrapperSession)";
        }
    } catch {
        // fallthrough
    }
    if (session === null && ctx.session !== null) {
        session = ctx.session;
        out["sessionSource"] = "own-create";
    }
    out["session"] = session
        ? { methods: listMethods(session), ownKeys: Object.getOwnPropertyNames(session) }
        : null;

    if (session !== null && session !== undefined) {
        const getters = listMethods(session).filter(
            (m) => m.startsWith("get") && m.endsWith("Service"),
        );
        const services: Record<string, unknown> = {};
        for (const getter of getters) {
            const call = tryCall(session, getter);
            if (call.ok && call.value) {
                const methods = listMethods(call.value);
                services[getter] = {
                    methods,
                    ownKeys: Object.getOwnPropertyNames(call.value).slice(0, 20),
                    shapes: shapeKeyGetters(call.value, methods),
                };
            } else {
                services[getter] = { error: call.error ?? "null/undefined", ok: call.ok };
            }
        }
        out["services"] = services;
    }
    return out;
}

/**
 * 探测 wrapper 运行时：dump session 方法与各 service 方法到 JSON。
 * 返回探测结果对象；同时写文件（NAPUTO_CFG_DIR/<file>，默认 napuketto-probe.json）。
 */
export function probeRuntime(
    ctx: WrapperContext,
    file = "napuketto-probe.json",
): Record<string, unknown> {
    const result: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        exports: listMethods(ctx.exports),
        engineMethods: listMethods(ctx.engine),
        exportCtors: probeExportCtors(ctx),
        engineCalls: probeEngineCalls(ctx),
        loginService: probeLoginService(ctx),
        startup: probeStartup(ctx),
        ...probeSession(ctx),
    };

    // 写文件
    try {
        const dir = process.env["NAPUTO_CFG_DIR"] ?? process.cwd();
        mkdirSync(dir, { recursive: true });
        const full = join(dir, file);
        writeFileSync(full, JSON.stringify(result, null, 2), "utf8");
        result["probeFile"] = full;
    } catch (e) {
        result["probeFileError"] = e instanceof Error ? e.message : String(e);
    }
    return result;
}
