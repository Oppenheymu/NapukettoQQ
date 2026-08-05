"use strict";
/**
 * boot.cjs：运行在 QQ 定制版 Electron 主进程内（由 hook DLL 引导执行）。
 *
 * 职责：
 *  1. hook process.dlopen：截获 wrapper.node 的 module.exports（QQ preload 注册后）。
 *  2. 若未截获，轮询 require(wrapper.node)。
 *  3. import kernel 入口，调用 createWrapper(exports) 启动 Napuketto。
 *
 * 2026-08-05 事实：
 *  - QQ preload 在 C++ 层注册 wrapper.node（"register done. wrapper.node"）。
 *  - 纯 JS 再 process.dlopen(wrapper.node) 会 self-register 失败（模块无 nm_register_func）。
 *  → 只能截获 preload 已注册的 exports，无法自己触发第二次加载。
 *  - 但 QQ preload 注册后，exports 存在 module 缓存里；hook 住 process.dlopen 的
 *    module.exports 即可拿到（NapCat 同款做法）。
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

let wrapperExports = null;

// 优先读取 hook DLL 已生成的 exports（v5：hook napi_module_register 直接生成）
function tryReadGlobalExports() {
    try {
        const g = globalThis.__napukettoWrapperExports;
        if (g && typeof g === "object" && Object.keys(g).length > 0) {
            wrapperExports = g;
            const keys = Object.keys(wrapperExports);
            log(`GLOBAL captured wrapper exports (${keys.length}): ${keys.join(", ")}`);
            bootstrap();
            return true;
        }
    } catch {
        // ignore
    }
    return false;
}

// ---- hook process.dlopen（回退路径：若 QQ preload 走 JS 层 dlopen） ----
const dlopenOrig = process.dlopen;
process.dlopen = function (module, filename, flags) {
    const ret = dlopenOrig.call(this, module, filename, flags);
    const fn = String(filename ?? "");
    if (fn.includes("wrapper.node")) {
        wrapperExports = module.exports;
        const keys = Object.keys(wrapperExports ?? {});
        log(`CAPTURED wrapper.node exports (${keys.length}): ${keys.join(", ")}`);
        bootstrap();
    }
    return ret;
};

// ---- 等待截获（QQ preload 注册可能在 hook 之后） ----
let bootstrapped = false;
function bootstrap() {
    if (bootstrapped || !wrapperExports) return;
    bootstrapped = true;
    log("bootstrap: wrapper exports ready, importing kernel...");
    const kernelEntry = process.env.NAPUTO_KERNEL_ENTRY;
    if (!kernelEntry) {
        log("bootstrap: NAPUTO_KERNEL_ENTRY not set");
        return;
    }
    try {
        // import kernel 入口（.mjs）
        import("file://" + kernelEntry.replace(/\\/g, "/"))
            .then((kernel) => {
                log(`bootstrap: kernel imported, keys: ${Object.keys(kernel).join(", ")}`);
                if (typeof kernel.startNapuketto === "function") {
                    // 把引导环境透传给 kernel（版本/数据目录/wrapper 路径）
                    const bootEnv = {
                        qqVersion: process.env.NAPUTO_QQ_VERSION,
                        dataDir: process.env.NAPUTO_CFG_DIR,
                        wrapperPath: process.env.NAPUTO_WRAPPER_PATH,
                    };
                    try {
                        const ctx = kernel.startNapuketto({
                            wrapperExports,
                            env: bootEnv,
                        });
                        log(
                            `bootstrap: startNapuketto OK, engine=${typeof ctx.engine}, session=${ctx.session !== null}`,
                        );
                        // 探测模式（NAPUTO_PROBE=1）：反射 dump session/service 方法
                        if (process.env.NAPUTO_PROBE === "1" && typeof kernel.probeRuntime === "function") {
                            try {
                                const probe = kernel.probeRuntime(ctx);
                                log(
                                    `bootstrap: probe done, session=${probe.session ? "ok" : "null"}, services=${Object.keys(probe.services ?? {}).length}`,
                                );
                                // 延迟二次探测：等 QQ 完成登录后 session/service 才完整
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
                        log(`bootstrap: startNapuketto error: ${e?.message ?? e}`);
                    }
                } else {
                    log("bootstrap: kernel has no startNapuketto export");
                }
            })
            .catch((e) => {
                log(`bootstrap: import kernel failed: ${e.message}`);
            });
    } catch (e) {
        log(`bootstrap: error: ${e.message}`);
    }
}

// 轮询：优先读 globalThis.__napukettoWrapperExports（hook 生成），
// 其次尝试 process.dlopen 命中已注册模块（nm_filename 匹配时）
const wrapperPath =
    process.env.NAPUTO_WRAPPER_PATH || "C:/Program Files/Tencent/QQNT/versions/9.9.31-49919/resources/app/wrapper.node";

const poll = setInterval(() => {
    if (bootstrapped) {
        clearInterval(poll);
        return;
    }
    if (tryReadGlobalExports()) {
        return;
    }
    // 回退：尝试触发 QQ preload 已经注册好的 exports（通过 require 缓存）
    try {
        const m = { exports: {} };
        process.dlopen(m, wrapperPath);
        if (Object.keys(m.exports).length > 0) {
            wrapperExports = m.exports;
            log(`POLL captured wrapper exports (${Object.keys(wrapperExports).length})`);
            bootstrap();
        }
    } catch {
        // 未就绪，继续等
    }
}, 500);

log("boot ready, waiting for wrapper.node registration...");
