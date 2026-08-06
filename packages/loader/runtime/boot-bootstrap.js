"use strict";
/**
 * boot-bootstrap.js：kernel 引导核心（import kernel → 装配 → 登录 → session 替换 → 协议装配）。
 * 由 boot.cjs 在截获 wrapper.node exports 后调用。
 *
 * V2（2026-08-06）关键改动——session 来源：
 *  - V1：Proxy 拦截 `new` 捕获 QQ 自己的 session（9.9.31 主进程 JS 侧无有效 session，已废弃）。
 *  - V2：vehicle 载具 C++ 侧创建 NTWrapperSession 并注册进单例表（key="Session"）。
 *    boot 登录成功后按优先级取 session：
 *      ① kernel.getMainSession(ctx)（startup 链路 getNTWrapperSession(nt_x)——QQ 主 session，
 *        渲染进程已完成 init → getMsgService READY）
 *      ② getNTWrapperSession("Session")（vehicle 激活，对象有效但未 init → 由 kernel
 *        initAndStartSession 挂载 service）
 *      ③ get() / qqSession（V1 兼容）
 *    取到后 core.setSession 替换 → waitSessionReady 确认 getMsgService READY。
 */
const path = require("node:path");
const { log } = require("./boot-util.js");
const { startProtocols } = require("./boot-protocols.js");

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 打印可用快速登录账号 + 返回目标账号（启动横幅）。 */
async function pickLoginAccount(kernel, ctx, loginResultRef) {
    try {
        const accounts = await kernel.listLoginAccounts(ctx);
        if (accounts.length > 0) {
            log(`可用于快速登录 of QQ（${accounts.length} 个）：`);
            accounts.forEach((acct, idx) => {
                const nick = acct.nickName || acct.uin;
                const marker = acct.isQuickLogin ? "（默认）" : "";
                log(`${idx + 1}. ${acct.uin} ${nick}${marker}`);
            });
            const target = accounts.find((a) => a.isQuickLogin) ?? accounts[0];
            loginResultRef.targetUin = target.uin;
            log(`正在快速登录 ${target.uin}`);
        } else {
            log("没有历史登录账号，将使用二维码登录方式");
        }
    } catch (listErr) {
        log(`bootstrap: 获取登录列表失败: ${listErr?.message ?? listErr}`);
    }
}

/**
 * 登录（快速登录 → QR 回退）。
 * @returns LoginResult | null（失败返回 null，不抛出——QR 兜底在内部）
 */
async function doLogin(core, opts) {
    try {
        return await core.login(opts);
    } catch (loginErr) {
        // 快速登录失败 → QR 回退（二维码写缓存目录，boot 日志提示）
        log(`bootstrap: 快速登录失败（${loginErr?.message ?? loginErr}），尝试 QR 登录`);
        try {
            return await core.login({ ...opts, qrFallback: true });
        } catch (qrErr) {
            log(`bootstrap: QR 登录也失败: ${qrErr?.message ?? qrErr}`);
            return null;
        }
    }
}

/** session 就绪探测（5s 间隔，60s 上限）——观察 qqSession / get() 状态。 */
function startSessionProbe(state, ctx, durationMs = 60000) {
    const sessionProbe = setInterval(() => {
        try {
            const S2 = state.wrapperExports?.NodeIQQNTWrapperSession;
            const out = [];
            // 通用 sessionId 提取（getSessionId 方法存在则打印——确认单例表身份）
            const describe = (s) => {
                if (!s) return "null";
                try {
                    const id = typeof s.getSessionId === "function" ? String(s.getSessionId()) : "?";
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
            log(`bootstrap: session.init=${typeof s.init} startNT=${typeof s.startNT} getMsgService=${typeof s.getMsgService}`);
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

/** 核心引导：import kernel → 装配 → 登录 → 替换 session → 等待就绪 → 协议装配。 */
async function bootstrap(state) {
    const kernelEntry = process.env.NAPUTO_KERNEL_ENTRY;
    if (!kernelEntry) {
        log("bootstrap: NAPUTO_KERNEL_ENTRY not set");
        return;
    }
    try {
        const kernel = await import("file://" + kernelEntry.replace(/\\/g, "/"));
        log(`bootstrap: kernel imported, keys: ${Object.keys(kernel).join(", ")}`);
        if (typeof kernel.startNapuketto !== "function" && typeof kernel.NapukettoCore !== "function") {
            log("bootstrap: kernel 无 startNapuketto/NapukettoCore 导出");
            return;
        }
        const bootEnv = {
            qqVersion: process.env.NAPUTO_QQ_VERSION,
            dataDir: process.env.NAPUTO_CFG_DIR,
            wrapperPath: process.env.NAPUTO_WRAPPER_PATH,
        };
        try {
            if (typeof kernel.NapukettoCore === "function") {
                // 装配层路径：NapukettoCore.create → attachWrapper → login
                const core = kernel.NapukettoCore.create({
                    paths: { dataRoot: bootEnv.dataDir },
                    logLevel: "info",
                });
                // 不传 qqSession/qqLoginService（登录前捕获的旧实例已失效/会干扰；
                // framework 语义：登录成功后 kernel 自己 create+init）
                const ctx = core.attachWrapper(state.wrapperExports, bootEnv);
                log(`bootstrap: attachWrapper OK, engine=${typeof ctx.engine}, session=${ctx.session !== null}`);

                // 探测：create() 与捕获的 QQ session 关系（确认 create() 是否干扰 QQ）
                try {
                    const S2 = state.wrapperExports.NodeIQQNTWrapperSession;
                    const created = typeof S2.create === "function" ? S2.create() : null;
                    log(
                        `BOOT: create()===qqSession? ${created === state.qqSession} | create()===ctx.session? ${created === ctx.session} | qqSession===ctx.session? ${state.qqSession === ctx.session}`,
                    );
                    const svc =
                        created && typeof created.getMsgService === "function"
                            ? created.getMsgService()
                            : null;
                    log(
                        `BOOT: create().getMsgService=${svc !== null && svc !== undefined ? "ready" : "null"} qqSession.getMsgService=${state.qqSession && typeof state.qqSession.getMsgService === "function" && state.qqSession.getMsgService() !== null && state.qqSession.getMsgService() !== undefined ? "ready" : "null"}`,
                    );
                } catch (e) {
                    log(`BOOT: create() 探测失败: ${e?.message ?? e}`);
                }
                // 多源 session 就绪探测（5s 间隔，60s 上限）
                startSessionProbe(state, ctx);

                // 探测 session 方法面（NAPI 反射，验证 startNT/init 等关键方法）
                probeSessionMethods(ctx);

                let loginResult = null;
                if (typeof core.login === "function") {
                    // 打印可用快速登录账号（启动横幅）
                    const ref = { targetUin: undefined };
                    await pickLoginAccount(kernel, ctx, ref);
                    const loginOpts = {
                        appid: "537237765",
                        initTimeoutMs: 20000,
                        ...(ref.targetUin !== undefined ? { quickUin: ref.targetUin } : {}),
                    };
                    loginResult = await doLogin(core, loginOpts);
                    if (loginResult === null) {
                        log("bootstrap: 登录失败，引导中止");
                        return;
                    }
                    log(`bootstrap: 登录成功 uin=${loginResult.uin} uid=${loginResult.uid} nick=${loginResult.nick}`);

                    // ⭐ V2 登录后替换 session：优先 QQ 主 session（渲染进程已 init），
                    // 其次 vehicle 激活的单例表 session。替换 kernel 自建的无效 session。
                    const candidates = collectCandidateSessions(state, kernel, ctx);
                    const chosen = pickBestSession(candidates);
                    if (chosen && chosen.s !== ctx.session) {
                        core.setSession(chosen.s);
                        log(
                            `bootstrap: 已替换 session（来源=${chosen.tag}，msgSvc=${isSessionUsable(chosen.s) ? "READY" : "null"}）`,
                        );
                    } else if (chosen) {
                        log(`bootstrap: 候选 session 与 ctx.session 相同（${chosen.tag}）`);
                    } else {
                        log("bootstrap: 无有效候选 session（保留 kernel 自建 session）");
                    }

                    // ⭐ 若替换的 session 未 READY（service 未挂载），对其执行 kernel 标准
                    // init（JS 侧 session.init，NAPI 自动转换——无需逆向 C++ SessionConfig）。
                    // 注：QQ 主 session（getMainSession）已由渲染进程 init，此处通常跳过。
                    if (chosen && !isSessionUsable(chosen.s)) {
                        log("bootstrap: 对激活 session 执行 init（挂载 service）...");
                        try {
                            const sessionConfig = kernel.buildSessionConfig({
                                appid: "537237765",
                                fullVersion: bootEnv.qqVersion || "",
                                selfUin: loginResult.uin,
                                selfUid: loginResult.uid,
                                accountPath: bootEnv.dataDir || ".",
                                downloadPath: path.join(bootEnv.dataDir || ".", "temp"),
                            });
                            const listener = kernel.createLifecycleSessionListener();
                            await kernel.initAndStartSession(ctx, sessionConfig, listener, {
                                timeoutMs: 20000,
                            });
                            log("bootstrap: 激活 session init + startNT 完成");
                        } catch (initErr) {
                            log(`bootstrap: 激活 session init 失败: ${initErr?.message ?? initErr}`);
                        }
                    }

                    // 等 session 就绪（getMsgService 非 null）——init 完成后才有
                    try {
                        await kernel.waitSessionReady(ctx, { timeoutMs: 30000 });
                        log("bootstrap: QQ session 就绪（getMsgService 可用）");
                    } catch (readyErr) {
                        log(`bootstrap: 等待 session 就绪失败: ${readyErr?.message ?? readyErr}`);
                    }
                } else {
                    log("bootstrap: kernel core missing login fn");
                }
                // 协议装配（adapter + network，登录成功后）
                if (loginResult !== null) {
                    await startProtocols(kernel, ctx, loginResult);
                }
                // 探测模式
                if (process.env.NAPUTO_PROBE === "1" && typeof kernel.probeRuntime === "function") {
                    try {
                        const probe = kernel.probeRuntime(ctx);
                        log(
                            `bootstrap: probe done, session=${probe.session ? "ok" : "null"}, services=${Object.keys(probe.services ?? {}).length}`,
                        );
                        setTimeout(() => {
                            try {
                                const late = kernel.probeRuntime(ctx, "napuketto-probe-late.json");
                                log(
                                    `bootstrap: probe-late done, session=${late.session ? "ok" : "null"}, services=${Object.keys(late.services ?? {}).length}`,
                                );
                            } catch (e2) {
                                log(`bootstrap: probe-late error: ${e2?.message ?? e2}`);
                            }
                        }, 35000);
                    } catch (e) {
                        log(`bootstrap: probe error: ${e?.message ?? e}`);
                    }
                }
            } else {
                // 回退：旧装配路径（startNapuketto + 手工 lifecycle）
                log("bootstrap: kernel has no NapukettoCore, falling back");
                const ctx = kernel.startNapuketto({
                    wrapperExports: state.wrapperExports,
                    env: bootEnv,
                });
                log(
                    `bootstrap: startNapuketto OK, engine=${typeof ctx.engine}, session=${ctx.session !== null}`,
                );
                if (typeof kernel.quickLogin === "function" &&
                    typeof kernel.initAndStartSession === "function") {
                    if (typeof kernel.buildLoginConfig === "function" && ctx.loginService) {
                        const loginCfg = kernel.buildLoginConfig(
                            "537237765",
                            bootEnv.qqVersion || "",
                            bootEnv.dataDir || ".",
                        );
                        if (typeof ctx.loginService.initConfig === "function") {
                            ctx.loginService.initConfig(loginCfg);
                            log("bootstrap: loginService.initConfig OK");
                        }
                    }
                    const loginResult = await kernel.quickLogin(ctx, {});
                    log(`bootstrap: quickLogin OK, uin=${loginResult.uin}, uid=${loginResult.uid}`);
                    const sessionConfig = kernel.buildSessionConfig({
                        appid: "537237765",
                        fullVersion: bootEnv.qqVersion || "",
                        selfUin: loginResult.uin,
                        selfUid: loginResult.uid,
                        accountPath: bootEnv.dataDir || ".",
                        downloadPath: path.join(bootEnv.dataDir || ".", "temp"),
                    });
                    const listener = kernel.createLifecycleSessionListener();
                    await kernel.initAndStartSession(ctx, sessionConfig, listener, { timeoutMs: 20000 });
                    log("bootstrap: session init + startNT OK!");
                } else {
                    log("bootstrap: kernel missing lifecycle fns (quickLogin/initAndStartSession)");
                }
                if (process.env.NAPUTO_PROBE === "1" && typeof kernel.probeRuntime === "function") {
                    try {
                        const probe = kernel.probeRuntime(ctx);
                        log(
                            `bootstrap: probe done, session=${probe.session ? "ok" : "null"}, services=${Object.keys(probe.services ?? {}).length}`,
                        );
                    } catch (e) {
                        log(`bootstrap: probe error: ${e?.message ?? e}`);
                    }
                }
            }
        } catch (e) {
            log(`bootstrap: lifecycle error: ${e?.message ?? e}`);
        }
    } catch (e) {
        log(`bootstrap: import kernel failed: ${e.message}`);
    }
}

module.exports = { bootstrap };
