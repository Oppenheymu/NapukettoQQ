"use strict";
/**
 * boot-bootstrap.js：kernel 引导核心（import kernel → 装配 → 登录 → session 替换 → 协议装配）。
 * 由 self-host.cjs（自建宿主，2026-08-07 唯一路线）在 dlopen wrapper.node 后调用。
 *
 * 2026-08-07 阶段 1 拆分（零语义改动）：
 *  - 登录流程（选账号 / 快速登录 / QR 回退）→ boot-login.js
 *  - session 选择 / 探测 / 就绪 → boot-session.js
 *  - 协议装配 → boot-protocols.js；冒烟自检 → boot-smoke.js
 *
 * session 来源（2026-08-07 实测结论；V1 Proxy 捕获与 vehicle 载具已归档 archive/）：
 *  登录成功后按优先级取 session：
 *    ① kernel.getMainSession(ctx)（startup 链路 getNTWrapperSession(nt_x)——QQ 主 session，
 *      渲染进程已完成 init → getMsgService READY）
 *    ② get() / qqSession（V1 兼容）
 *  取到后 core.setSession 替换 → waitSessionReady 确认 getMsgService READY。
 */
const path = require("node:path");
const { log } = require("./boot-util.js");
const { pickLoginAccount, doLogin } = require("./boot-login.js");
const {
    isSessionUsable,
    startSessionProbe,
    probeSessionMethods,
    collectCandidateSessions,
    pickBestSession,
} = require("./boot-session.js");
const { startProtocols } = require("./boot-protocols.js");
const { runSmokeTest } = require("./boot-smoke.js");

/** 核心引导：import kernel → 装配 → 登录 → 替换 session → 等待就绪 → 协议装配。 */
async function bootstrap(state) {
    const kernelEntry = process.env.NAPUTO_KERNEL_ENTRY;
    if (!kernelEntry) {
        log("bootstrap: NAPUTO_KERNEL_ENTRY not set");
        return;
    }
    try {
        const kernel = await import(`file://${kernelEntry.replace(/\\/g, "/")}`);
        log(`bootstrap: kernel imported, keys: ${Object.keys(kernel).join(", ")}`);
        if (
            typeof kernel.startNapuketto !== "function" &&
            typeof kernel.NapukettoCore !== "function"
        ) {
            log("bootstrap: kernel 无 startNapuketto/NapukettoCore 导出");
            return;
        }
        const bootEnv = {
            qqVersion: process.env.NAPUTO_QQ_VERSION,
            dataDir: process.env.NAPUTO_CFG_DIR,
            wrapperPath: process.env.NAPUTO_WRAPPER_PATH,
        };

        // ⭐ appid 动态解析（2026-08-06 P2-0 实测：硬编码 537237765 在 9.9.33 扫码失败
        // 「请下载最新版」；major.node 解析的 537376818 成功）。自研，参考 NapCat 思路。
        const Appid =
            (typeof kernel.parseAppidFromMajor === "function" &&
                bootEnv.wrapperPath &&
                kernel.parseAppidFromMajor(
                    path.join(path.dirname(bootEnv.wrapperPath), "major.node"),
                )) ||
            (typeof kernel.resolveAppidQua === "function" &&
                kernel.resolveAppidQua(bootEnv.qqVersion || "").appid) ||
            "537237765";
        log(`bootstrap: appid=${Appid}（wrapper=${bootEnv.wrapperPath}）`);
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
                log(
                    `bootstrap: attachWrapper OK, engine=${typeof ctx.engine}, session=${ctx.session !== null}`,
                );

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
                    // NAPUTO_QUICK_UIN 强制指定快速登录账号（实验/自建宿主验证用，
                    // 防止自动选中风控账号 3054108135 导致挂起——HANDOVER-V10 环境事实）。
                    const forcedUin = process.env.NAPUTO_QUICK_UIN;
                    const loginOpts = {
                        appid: Appid,
                        initTimeoutMs: 20000,
                        ...(forcedUin
                            ? { quickUin: forcedUin }
                            : ref.targetUin !== undefined
                              ? { quickUin: ref.targetUin }
                              : {}),
                    };
                    loginResult = await doLogin(core, loginOpts);
                    if (loginResult === null) {
                        log("bootstrap: 登录失败，引导中止");
                        return;
                    }
                    log(
                        `bootstrap: 登录成功 uin=${loginResult.uin} uid=${loginResult.uid} nick=${loginResult.nick}`,
                    );

                    // ⭐ V2 登录后替换 session：优先 QQ 主 session（渲染进程已 init），
                    // 其次 vehicle 激活的单例表 session。替换 kernel 自建的无效 session。
                    // 自建宿主（NAPUTO_SELF_HOST）例外：无 QQ 主进程/vehicle/qqSession 捕获，
                    // 且 getMainSession 内部会先 startupSession.start()——与「先 init 后
                    // start」顺序冲突（HANDOVER-V9 实证）；登录前 createSession 创建的
                    // 配套 session（ctx.session + ctx.startupSession）才是正确激活目标。
                    const isSelfHost = process.env.NAPUTO_SELF_HOST === "1";
                    let chosen = null;
                    if (!isSelfHost) {
                        const candidates = collectCandidateSessions(state, kernel, ctx);
                        chosen = pickBestSession(candidates);
                    }
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

                    // ⭐ 激活目标：优先候选 session，否则 kernel 自建 session。
                    // 自建宿主（NAPUTO_SELF_HOST，标准 node）无 QQ 主 session / vehicle
                    // 激活 / qqSession Proxy 捕获——候选可能为空，但 attachWrapper 时
                    // createSession（SSW.create + getNTWrapperSession("nt_1")）已创建
                    // ctx.session，直接对它走 NapCat 激活（先 init 后 start）。
                    const activateTarget = chosen ?? { s: ctx.session, tag: "kernel 自建 session" };
                    if (activateTarget.s && !isSessionUsable(activateTarget.s)) {
                        log(
                            `bootstrap: 激活 session（${activateTarget.tag}，先 init 后 startupSession.start）...`,
                        );
                        try {
                            // session 数据目录指向 QQ 真实数据目录（数据根/nt_qq/global，
                            // HANDOVER-V6 三要素之三）：cfgDir 下 init 的 onOpentelemetryInit
                            // 不触发（p0-kernel-flow 实证——accountPath 必须是 nt_qq/global）。
                            const qqDataRoot =
                                typeof kernel.resolveQqUserDataRoot === "function"
                                    ? kernel.resolveQqUserDataRoot(state.wrapperExports)
                                    : null;
                            const accountPath =
                                qqDataRoot && typeof kernel.resolveQqGlobalPath === "function"
                                    ? kernel.resolveQqGlobalPath(qqDataRoot)
                                    : bootEnv.dataDir || ".";
                            const sessionConfig = kernel.buildSessionConfig({
                                appid: Appid,
                                fullVersion: bootEnv.qqVersion || "",
                                selfUin: loginResult.uin,
                                selfUid: loginResult.uid,
                                accountPath,
                                downloadPath: path.join(accountPath, "NapCat", "temp"),
                            });
                            const listener = kernel.createLifecycleSessionListener();
                            // initAndStartSession 已修正：先 session.init 再 startupSession.start()
                            await kernel.initAndStartSession(ctx, sessionConfig, listener, {
                                timeoutMs: 20000,
                            });
                            log("bootstrap: 激活 session init + start 完成");
                        } catch (initErr) {
                            log(
                                `bootstrap: 激活 session init 失败: ${initErr?.message ?? initErr}`,
                            );
                        }
                    }

                    // 等 session 就绪（getMsgService 非 null）——init 完成后才有
                    try {
                        await kernel.waitSessionReady(ctx, { timeoutMs: 30000 });
                        log("bootstrap: QQ session 就绪（getMsgService 可用）");
                    } catch (readyErr) {
                        log(`bootstrap: 等待 session 就绪失败: ${readyErr?.message ?? readyErr}`);
                    }
                    // P2-1 收发消息冒烟自检（NAPUTO_SMOKE=1）：MsgBridge + MsgApi 真发/收一条
                    if (process.env.NAPUTO_SMOKE === "1" && loginResult !== null) {
                        try {
                            const ok = await runSmokeTest(kernel, ctx, loginResult);
                            log(
                                `bootstrap: 冒烟自检${ok ? "通过" : "未完全通过"}（见上文 smoke 日志）`,
                            );
                        } catch (smokeErr) {
                            log(`bootstrap: 冒烟自检异常: ${smokeErr?.message ?? smokeErr}`);
                        }
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
                if (
                    typeof kernel.quickLogin === "function" &&
                    typeof kernel.initAndStartSession === "function"
                ) {
                    if (typeof kernel.buildLoginConfig === "function" && ctx.loginService) {
                        const loginCfg = kernel.buildLoginConfig(
                            Appid,
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
                        appid: Appid,
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
