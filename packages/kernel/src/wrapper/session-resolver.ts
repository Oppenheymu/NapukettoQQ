/**
 * session 解析（2026-08-05，wrapper 机制实测确认后）
 *
 * - getMainSession：startup.create → getSessionIdList → getNTWrapperSession(nt_x)
 *   （实测这些返回的 session 是空壳——核心 service 未 init，仅作参考）
 * - 真正可用的 session 是 `new wrapper.NodeIQQNTWrapperSession()` + init（见 lifecycle.ts）
 */

import type { NodeIQQNTWrapperSession } from "../types/index.js";
import type { WrapperContext } from "./wrapper-loader.js";

/** 从 getSessionIdList 的 Map 提取主 sessionId（nt_ 前缀优先）。 */
function findMainSessionId(ids: Map<unknown, unknown>): string | null {
    for (const [k, v] of ids) {
        if (typeof v === "string") {
            if (v.startsWith("nt_")) {
                return v;
            }
        } else if (typeof k === "string" && k.startsWith("nt_")) {
            return k;
        }
    }
    for (const [, v] of ids) {
        if (typeof v === "string") {
            return v;
        }
    }
    for (const k of ids.keys()) {
        if (typeof k === "string") {
            return k;
        }
    }
    return null;
}

/** 通过 getNTWrapperSession 拿主 session（内部辅助）。 */
function resolveMainSession(
    created: { start?: () => void; getSessionIdList?: () => unknown },
    getNTWrapperSession: (id: string) => NodeIQQNTWrapperSession,
): NodeIQQNTWrapperSession | null {
    if (typeof created.start === "function") {
        created.start();
    }
    if (typeof created.getSessionIdList !== "function") {
        return null;
    }
    const ids = created.getSessionIdList();
    if (!(ids instanceof Map)) {
        return null;
    }
    const mainId = findMainSessionId(ids);
    if (mainId === null) {
        return null;
    }
    const session = getNTWrapperSession(mainId);
    const maybe = session as NodeIQQNTWrapperSession | null | undefined;
    if (maybe !== null && maybe !== undefined && typeof maybe.getMsgService === "function") {
        return maybe;
    }
    return null;
}

/**
 * 复用 QQ 已有 session（P1-4：QQ 已登录，直接拿单例避免重复 init）。
 * 优先 `NodeIQQNTWrapperSession.get()`；返回 null 时回退 createSession。
 */
export function getExistingSession(ctx: WrapperContext): NodeIQQNTWrapperSession | null {
    try {
        const S = ctx.exports.NodeIQQNTWrapperSession as unknown as {
            get?: () => NodeIQQNTWrapperSession;
        };
        if (typeof S.get === "function") {
            const got = S.get();
            if (got && typeof got.getMsgService === "function") {
                ctx.session = got;
                return got;
            }
        }
    } catch {
        // 复用失败，回退 create
    }
    return null;
}

/**
 * 复用 QQ 主 session（P1-4 实测链路）：
 * `NodeIQQNTStartupSessionWrapper.create()` → `start()` → `getSessionIdList()`（Map
 * {nt:"nt_3", gpro:"gpro_3"}）→ `NodeIQQNTWrapperSession.getNTWrapperSession("nt_3")`。
 * 注：实测这些 session 是空壳（核心 service null），真正可用的是 new + init（lifecycle.ts）。
 */
export function getMainSession(ctx: WrapperContext): NodeIQQNTWrapperSession | null {
    try {
        const startupRaw = ctx.exports.NodeIQQNTStartupSessionWrapper as unknown as {
            create?: () => { start?: () => void; getSessionIdList?: () => unknown } | null;
        };
        const sessionCtor = ctx.exports.NodeIQQNTWrapperSession as unknown as {
            getNTWrapperSession?: (id: string) => NodeIQQNTWrapperSession;
        };
        if (
            typeof startupRaw.create !== "function" ||
            typeof sessionCtor.getNTWrapperSession !== "function"
        ) {
            return null;
        }
        const created = startupRaw.create();
        if (!created) {
            return null;
        }
        const getSession = (id: string): NodeIQQNTWrapperSession =>
            (sessionCtor.getNTWrapperSession as (name: string) => NodeIQQNTWrapperSession)(id);
        const session = resolveMainSession(created, getSession);
        if (session !== null) {
            ctx.session = session;
        }
        return session;
    } catch {
        // 复用失败，回退 create
    }
    return null;
}
