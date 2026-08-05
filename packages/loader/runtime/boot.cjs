"use strict";
/**
 * boot.cjs：运行在 QQ 定制版 Electron 主进程内（由 hook DLL 引导执行）。
 *
 * 职责：
 *  1. hook process.dlopen：截获 wrapper.node 的 module.exports（QQ preload 注册后）。
 *  2. **Proxy 拦截 exports 构造器的 `new`**：捕获 QQ 自己创建的
 *     NodeIQQNTWrapperSession / NodeIKernelLoginService 实例（NapCat 同款机制，
 *     2026-08-05 从 NapCatQQ 参考确认）。
 *  3. 等 QQ 完成 session init（onSessionInitComplete）后，用**已 init 的 session**
 *     import kernel 启动 Napuketto。
 *
 * 关键认知（2026-08-05 修正）：
 *  - 之前用 startup.create() 创建 session 是**错误**的——那是空 session（service 全 null）。
 *  - QQ 自己会 `new NodeIQQNTWrapperSession()` 并 init/startNT，实例里 service 完整。
 *  - 正确做法：拦截 `new` 窃取 QQ 的 session，等 onSessionInitComplete 后用。
 */

const fs = require("node:fs");
const path = require("node:path");

const LOG_PATH = process.env.NAPUTO_CFG_DIR
    ? path.join(process.env.NAPUTO_CFG_DIR, "napuketto-boot.log")
    : path.join(require("node:os").tmpdir(), "napuketto-boot.log");

function log(msg) {
    try {
        fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`);
    } catch {
        // ignore
    }
}

log(`boot loaded: node=${process.version} electron=${process.versions.electron ?? "n/a"}`);
log(`cwd: ${process.cwd()}`);
log(`env NAPUTO_BOOT_JS=${process.env.NAPUTO_BOOT_JS}`);

// ---- 捕获状态 ----
let wrapperExports = null;

// ---- hook process.dlopen 拿 exports（QQ preload 注册后） ----
const dlopenOrig = process.dlopen;
process.dlopen = function (module, filename, flags) {
    const ret = dlopenOrig.call(this, module, filename, flags);
    const fn = String(filename ?? "");
    if (!fn.includes("wrapper.node")) return ret;
    wrapperExports = module.exports;
    log(`CAPTURED wrapper.node exports (${Object.keys(wrapperExports ?? {}).length})`);
    maybeBootstrap();
    return ret;
};

// ---- 等待 exports 就绪 ----
let bootstrapped = false;
function maybeBootstrap() {
    if (bootstrapped) return;
    if (!wrapperExports) return;
    log("wrapper exports ready, starting lifecycle...");
    bootstrap();
}

// 兜底轮询：dlopen hook 可能拿到不完整 exports（首次 dlopen 注册未完成）
const wrapperPath =
    process.env.NAPUTO_WRAPPER_PATH || "C:/Program Files/Tencent/QQNT/versions/9.9.31-49919/resources/app/wrapper.node";

const pollInterval = setInterval(() => {
    if (bootstrapped) {
        clearInterval(pollInterval);
        return;
    }
    try {
        const m = { exports: {} };
        process.dlopen(m, wrapperPath);
        if (m.exports && Object.keys(m.exports).length > 0) {
            wrapperExports = m.exports;
            log(`POLL captured wrapper exports (${Object.keys(wrapperExports).length})`);
            bootstrap();
        }
    } catch {
        // 未就绪，继续等
    }
}, 500);
// 60s 超时兜底
setTimeout(() => clearInterval(pollInterval), 60000);

function bootstrap() {
    if (bootstrapped) return;
    bootstrapped = true;
    log("bootstrap: importing kernel...");
    const kernelEntry = process.env.NAPUTO_KERNEL_ENTRY;
    if (!kernelEntry) {
        log("bootstrap: NAPUTO_KERNEL_ENTRY not set");
        return;
    }
    try {
        import("file://" + kernelEntry.replace(/\\/g, "/"))
            .then(async (kernel) => {
                log(`bootstrap: kernel imported, keys: ${Object.keys(kernel).join(", ")}`);
                if (typeof kernel.startNapuketto !== "function") {
                    log("bootstrap: kernel has no startNapuketto export");
                    return;
                }
                const bootEnv = {
                    qqVersion: process.env.NAPUTO_QQ_VERSION,
                    dataDir: process.env.NAPUTO_CFG_DIR,
                    wrapperPath: process.env.NAPUTO_WRAPPER_PATH,
                };
                try {
                    // 1. 装配（createWrapper + engine.init）
                    const ctx = kernel.startNapuketto({
                        wrapperExports,
                        env: bootEnv,
                    });
                    log(
                        `bootstrap: startNapuketto OK, engine=${typeof ctx.engine}, session=${ctx.session !== null}`,
                    );
                    // 2. 完整生命周期：loginService → 快速登录 → session.init → startNT
                    if (typeof kernel.quickLogin === "function" &&
                        typeof kernel.initAndStartSession === "function") {
                        // 2a. loginService.initConfig（NapCat shell 流程：addListener 前）
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
                } catch (e) {
                    log(`bootstrap: lifecycle error: ${e?.message ?? e}`);
                }
            })
            .catch((e) => {
                log(`bootstrap: import kernel failed: ${e.message}`);
            });
    } catch (e) {
        log(`bootstrap: error: ${e.message}`);
    }
}

log("boot ready, waiting for wrapper exports...");
