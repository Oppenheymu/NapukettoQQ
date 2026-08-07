"use strict";
/**
 * boot-session.js：session 选择与就绪探测（2026-08-07 阶段 1 从 boot-bootstrap.js 拆分，
 * 零语义改动）。
 *
 * 职责：候选 session 收集（QQ 主 session → vehicle 激活 session → get() → qqSession）、
 * 最佳 session 选择（READY 优先）、session 有效性判断、就绪探测（5s 间隔定时器）。
 * 由 boot-bootstrap.js require（纯函数，无状态）。
 */
const { log } = require("./boot-util.js");

/** 对象有效性判断：getMsgService() 调用不抛断言（cpp_impl 已激活）。
 * 与 isSessionUsable 的区别：这里允许返回 null（未 init 但对象有效）。 */
function isSessionObjectValid(s) {
    if (!s) return false;
    try {
        s.getMsgService();
        return true;
    } catch {
        return false;
    }
}

/** session 可用性判断：getMsgService() 可调且非 null（核心 service 已挂载）。 */
function isSessionUsable(s) {
    if (!s) return false;
    try {
        const svc = s.getMsgService();
        return svc !== null && svc !== undefined;
    } catch {
        return false;
    }
}

/** session 就绪探测（5s 间隔，60s 上限）——观察 qqSession / get() 状态。 */
function startSessionProbe(state, _ctx, durationMs = 60000) {
    const sessionProbe = setInterval(() => {
        try {
            const S2 = state.wrapperExports?.NodeIQQNTWrapperSession;
            const out = [];
            // 通用 sessionId 提取（getSessionId 方法存在则打印——确认单例表身份）
            const describe = (s) => {
                if (!s) return "null";
                try {
                    const id =
                        typeof s.getSessionId === "function" ? String(s.getSessionId()) : "?";
                    const svc = typeof s.getMsgService === "function" ? s.getMsgService() : null;
                    return `id=${id} msgSvc=${svc !== null && svc !== undefined ? "READY" : "null"}`;
                } catch (e) {
                    return `id=? msgSvc=断言(${String(e.message ?? e).slice(0, 60)})`;
                }
            };
            if (state.qqSession && typeof state.qqSession.getMsgService === "function") {
                out.push(`qqSession[${describe(state.qqSession)}]`);
            }
            if (S2 && typeof S2.get === "function") {
                const got = S2.get();
                out.push(`get()[${describe(got)}]`);
            }
            if (S2 && typeof S2.getNTWrapperSession === "function") {
                const gotNT = S2.getNTWrapperSession("Session");
                if (gotNT) out.push(`getNT("Session")[${describe(gotNT)}]`);
            }
            log(`BOOT: session 探测: ${out.join(" | ")}`);
        } catch (e) {
            log(`BOOT: session 探测失败: ${e?.message ?? e}`);
        }
    }, 5000);
    setTimeout(() => clearInterval(sessionProbe), durationMs);
    return sessionProbe;
}

/** 探测 session 方法面（NAPI 反射，验证 startNT/init 等关键方法）。 */
function probeSessionMethods(ctx) {
    try {
        const s = ctx.session;
        if (s) {
            const names = [
                ...Object.getOwnPropertyNames(Object.getPrototypeOf(s) ?? {}),
                ...Object.keys(s ?? {}),
            ];
            log(`bootstrap: session methods(${names.length}): ${[...new Set(names)].join(", ")}`);
            log(
                `bootstrap: session.init=${typeof s.init} startNT=${typeof s.startNT} getMsgService=${typeof s.getMsgService}`,
            );
        }
    } catch (e) {
        log(`bootstrap: session 探测失败: ${e?.message ?? e}`);
    }
}

/** 收集候选 session（按优先级：QQ 主 session → vehicle 激活 session → get() → qqSession）。
 * 返回 { session, tag, ready }。ready=true 表示 getMsgService 已非 null（渲染进程已完成 init）。 */
function collectCandidateSessions(state, kernel, ctx) {
    const candidates = [];
    const S2 = state.wrapperExports?.NodeIQQNTWrapperSession;
    // A: QQ 主 session（startup 链路 getSessionIdList → getNTWrapperSession(nt_x)），
    //    渲染进程已 init → 大概率 READY（kernel session-resolver.ts 实测链路）。
    try {
        if (typeof kernel.getMainSession === "function") {
            const ms = kernel.getMainSession(ctx);
            if (ms) candidates.push({ s: ms, tag: "getMainSession(nt_x)" });
        }
    } catch (e) {
        log(`bootstrap: getMainSession 失败: ${e?.message ?? e}`);
    }
    // B: vehicle 激活的 session（注册 key="Session"，对象有效但未 init）
    try {
        if (S2 && typeof S2.getNTWrapperSession === "function") {
            const got = S2.getNTWrapperSession("Session");
            if (got) candidates.push({ s: got, tag: "getNT(Session)" });
        }
    } catch (e) {
        log(`bootstrap: getNTWrapperSession 失败: ${e?.message ?? e}`);
    }
    // C: get()（单例表默认项）
    try {
        if (S2 && typeof S2.get === "function") {
            const got = S2.get();
            if (got) candidates.push({ s: got, tag: "get()" });
        }
    } catch (e) {
        log(`bootstrap: get() 失败: ${e?.message ?? e}`);
    }
    // D: Proxy 捕获的 QQ session（V1 兼容）
    if (state.qqSession) candidates.push({ s: state.qqSession, tag: "qqSession" });
    return candidates;
}

/** 从候选里选最佳 session：优先有效对象，且 READY（msgSvc 非 null）优先。 */
function pickBestSession(candidates) {
    let bestValid = null;
    for (const c of candidates) {
        const ready = isSessionUsable(c.s);
        const valid = isSessionObjectValid(c.s);
        log(`bootstrap: 候选 ${c.tag}: valid=${valid} msgSvc=${ready ? "READY" : "null/断言"}`);
        if (valid && bestValid === null) bestValid = c;
        if (ready) return c; // READY 直接用
    }
    return bestValid;
}

module.exports = {
    isSessionObjectValid,
    isSessionUsable,
    startSessionProbe,
    probeSessionMethods,
    collectCandidateSessions,
    pickBestSession,
};
