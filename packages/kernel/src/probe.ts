/**
 * 运行时反射探测（ADR-006 落地，P1-4）
 *
 * 注入链路打通后（2026-08-05），wrapper exports 是 QQ 已注册的单例。
 * 本模块在 **QQ 主进程内**反射枚举 session / service 的真实方法名与返回形状，
 * 产出 JSON 到 NAPUTO_CFG_DIR/napuketto-probe.json，作为 types/services/ 的权威来源。
 *
 * 用法：boot.cjs 在 NAPUTO_PROBE=1 时于 startNapuketto 后调用 probeRuntime(ctx)。
 * 产物是研究工具数据，类型层据此补全（自研描述，非移植）。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import type { WrapperContext } from "./wrapper-loader.js";
import { getMainSession } from "./wrapper-loader.js";

/** 反射枚举一个对象原型链上的方法名（去重、去构造器）。 */
function listMethods(obj: unknown): string[] {
    if (obj === null || obj === undefined) {
        return [];
    }
    const names = new Set<string>();
    let proto = Object.getPrototypeOf(obj);
    while (proto && proto !== Object.prototype && proto !== Function.prototype) {
        for (const name of Object.getOwnPropertyNames(proto)) {
            if (name !== "constructor") {
                names.add(name);
            }
        }
        proto = Object.getPrototypeOf(proto);
    }
    // 自有属性方法也并入
    for (const name of Object.getOwnPropertyNames(obj)) {
        if (name !== "constructor") {
            names.add(name);
        }
    }
    return [...names].sort();
}

/** 安全调用：尝试调用方法拿返回值，失败记录错误（不中断探测）。 */
function tryCall(obj: unknown, name: string): { ok: boolean; value?: unknown; error?: string } {
    try {
        const fn = (obj as Record<string, unknown>)[name];
        if (typeof fn !== "function") {
            return { ok: false, error: `not a function (typeof=${typeof fn})` };
        }
        const value = fn.call(obj);
        return { ok: true, value };
    } catch (e) {
        let message = String(e);
        if (e instanceof Error) {
            message = e.message;
        }
        return { ok: false, error: message };
    }
}

/** 序列化深度上限（循环引用/深层对象防护）。 */
const MAX_SERIALIZE_DEPTH = 4;
/** 数组序列化条数上限。 */
const MAX_ARRAY_ITEMS = 20;
/** 对象键序列化条数上限。 */
const MAX_OBJECT_KEYS = 50;

/** 序列化一个值（BigInt 转字符串，Map/Set/Promise 展开，循环引用防护）。 */
function serialize(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "function") return `[function ${value.name ?? "anon"}]`;
    if (typeof value !== "object") return value;
    if (depth > MAX_SERIALIZE_DEPTH) return "[depth-limit]";
    try {
        if (Array.isArray(value)) {
            return value.slice(0, MAX_ARRAY_ITEMS).map((v) => serialize(v, depth + 1));
        }
        if (value instanceof Map) {
            const out: Record<string, unknown> = {};
            let i = 0;
            for (const [k, v] of value) {
                if (i >= MAX_OBJECT_KEYS) break;
                out[String(k)] = serialize(v, depth + 1);
                i += 1;
            }
            return { kind: "Map", size: value.size, entries: out };
        }
        if (value instanceof Set) {
            return {
                kind: "Set",
                size: value.size,
                values: [...value].slice(0, MAX_ARRAY_ITEMS).map((v) => serialize(v, depth + 1)),
            };
        }
        if (typeof (value as Promise<unknown>).then === "function") {
            return "[Promise]";
        }
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value as object).slice(0, MAX_OBJECT_KEYS)) {
            out[key] = serialize((value as Record<string, unknown>)[key], depth + 1);
        }
        return out;
    } catch {
        return "[unserializable]";
    }
}

/** 尝试解析一个 service getter 的返回值形状（深度受限）。 */
function tryShape(session: unknown, getter: string): unknown {
    try {
        const fn = (session as Record<string, unknown>)[getter];
        if (typeof fn !== "function") return null;
        const value = fn.call(session);
        if (value === null || value === undefined) return null;
        return serialize(value);
    } catch {
        return "[error]";
    }
}

/** 数据 getter 方法名模式（探测返回形状用）。 */
const DATA_GETTER_RE = /^(get|query|fetch|load)/i;

/** 探测 service 的关键数据 getter 返回形状（取前几个无参调用）。 */
function shapeKeyGetters(session: unknown, serviceMethods: string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const candidates = serviceMethods.filter(
        (m) => DATA_GETTER_RE.test(m) && !m.endsWith("Listener"),
    );
    for (const m of candidates.slice(0, 8)) {
        out[m] = tryShape(session, m);
    }
    return out;
}

/** 探测关键 export 构造器方法（get/create/getNTWrapperSession 等）。 */
function probeExportCtors(ctx: WrapperContext): Record<string, unknown> {
    const keys = [
        "NodeIQQNTWrapperSession",
        "NodeIQQNTStartupSessionWrapper",
        "NodeQQNTWrapperUtil",
        "NodeIKernelLoginService",
        "NodeIQQNTWrapperEngine",
    ] as const;
    const out: Record<string, unknown> = {};
    for (const key of keys) {
        const ctor = (ctx.exports as unknown as Record<string, unknown>)[key];
        if (ctor !== null && ctor !== undefined) {
            out[key] = { methods: listMethods(ctor), ownKeys: Object.getOwnPropertyNames(ctor) };
        }
    }
    return out;
}

/** 探测 engine 关键调用（getDeviceInfo / getECDHService / getThirdPartySigService）。 */
function probeEngineCalls(ctx: WrapperContext): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const m of ["getDeviceInfo", "getECDHService", "getThirdPartySigService", "readyToShow"]) {
        const call = tryCall(ctx.engine, m);
        out[m] = call.ok
            ? { value: serialize(call.value), methods: call.value ? listMethods(call.value) : [] }
            : { error: call.error ?? "null/undefined" };
    }
    return out;
}

/** 探测 startup session 链路：create() → start() → getSessionIdList → getNTWrapperSession。 */
function probeStartup(ctx: WrapperContext): Record<string, unknown> | null {
    const startup = ctx.exports.NodeIQQNTStartupSessionWrapper;
    if (!startup) return null;
    const out: Record<string, unknown> = { staticMethods: listMethods(startup) };
    const created = tryCall(startup, "create");
    out["create"] = created.ok
        ? {
              methods: created.value ? listMethods(created.value) : [],
              value: serialize(created.value),
          }
        : { error: created.error };
    if (created.ok && created.value) {
        // start() 初始化 startup → 产生 sessionId
        const started = tryCall(created.value, "start");
        out["start"] = started.ok ? { ok: true } : { error: started.error };
        // 稍等再取 sessionId（start 异步）
        const ids = tryCall(created.value, "getSessionIdList");
        const idsValue = ids.ok ? serialize(ids.value) : null;
        out["createdGetSessionIdList"] = ids.ok ? { value: idsValue } : { error: ids.error };
        // 从 Map 里提取真实 sessionId（格式 nt_<N> / gpro_<N>）
        const foundIds: string[] = [];
        if (ids.ok && ids.value instanceof Map) {
            for (const [k, v] of ids.value) {
                const id = typeof v === "string" ? v : String(k);
                foundIds.push(id);
            }
        }
        out["sessionIds"] = foundIds;
        if (foundIds.length > 0) {
            const mainId = foundIds.find((id) => id.startsWith("nt_")) ?? foundIds[0];
            out["mainSessionId"] = mainId;
            // 用真实 sessionId 取主 session
            const S = ctx.exports.NodeIQQNTWrapperSession;
            const fn = (S as unknown as Record<string, unknown>)["getNTWrapperSession"];
            if (typeof fn === "function" && mainId !== undefined) {
                try {
                    const value = (fn as (...args: unknown[]) => unknown).call(S, mainId);
                    out["mainSession"] = value
                        ? {
                              methods: listMethods(value),
                              ownKeys: Object.getOwnPropertyNames(value),
                          }
                        : null;
                } catch (e) {
                    out["mainSession"] = {
                        error: e instanceof Error ? e.message : String(e),
                    };
                }
            }
            return out;
        }
    }
    // 尝试候选 sessionId 名取主 session（无 Map 数据时兜底）
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
    out["getNTWrapperSession"] = getResults;
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
