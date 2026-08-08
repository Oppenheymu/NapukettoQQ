/**
 * wrapper exports 探测（从 probe.ts 拆分，2026-08-08 FTA 优化）
 *
 * - probeExportCtors：关键 export 构造器方法面
 * - probeEngineCalls：engine 关键调用
 * - probeLoginService：LoginService 实例（QQ 已登录凭据入口）
 */

import { serialize, tryShape } from "./probe-serialize.js";
import { listMethods, tryCall } from "./probe-utils.js";
import type { WrapperContext } from "./wrapper-loader.js";

/** 探测关键 export 构造器方法（get/create/getNTWrapperSession 等）。 */
export function probeExportCtors(ctx: WrapperContext): Record<string, unknown> {
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
export function probeEngineCalls(ctx: WrapperContext): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const m of ["getDeviceInfo", "getECDHService", "getThirdPartySigService", "readyToShow"]) {
        const call = tryCall(ctx.engine, m);
        out[m] = call.ok
            ? { value: serialize(call.value), methods: call.value ? listMethods(call.value) : [] }
            : { error: call.error ?? "null/undefined" };
    }
    return out;
}

/** 探测 LoginService 实例（QQ 已登录凭据入口）。 */
export function probeLoginService(ctx: WrapperContext): Record<string, unknown> | null {
    const ctor = ctx.exports.NodeIKernelLoginService as unknown as {
        get?: () => unknown;
    } | null;
    if (ctor === null || typeof ctor.get !== "function") return null;
    const inst = tryCall(ctor, "get");
    if (!(inst.ok && inst.value)) {
        return { get: inst.error ?? "null/undefined" };
    }
    const out: Record<string, unknown> = {
        methods: listMethods(inst.value),
        ownKeys: Object.getOwnPropertyNames(inst.value).slice(0, 30),
    };
    // 尝试关键登录信息 getter（无参）
    const probes = [
        "getAccountInfo",
        "getLoginInfo",
        "getA2",
        "getTicket",
        "getUin",
        "getUid",
        "getSelfUin",
    ];
    for (const m of probes) {
        if (typeof (inst.value as Record<string, unknown>)[m] === "function") {
            out[m] = tryShape(inst.value, m);
        }
    }
    return out;
}
