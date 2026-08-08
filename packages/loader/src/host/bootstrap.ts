/**
 * bootstrap.ts：kernel 引导核心（import kernel → 装配 → 登录 → session 替换 → 协议装配）。
 * 2026-08-07 阶段 2：由 runtime/boot-bootstrap.js TS 化（零语义改动）。
 * 由 self-host.ts（自建宿主，2026-08-07 唯一路线）在 dlopen wrapper.node 后调用。
 *
 * 2026-08-07 阶段 1 拆分（零语义改动）：
 *  - 登录流程（选账号 / 快速登录 / QR 回退）→ login.ts
 *  - session 选择 / 探测 / 就绪 → session.ts
 *  - 协议装配 → protocols.ts；冒烟自检 → smoke.ts
 * 2026-08-08 FTA 优化：NapukettoCore 装配路径 → bootstrap-core.ts（本文件留入口 + fallback）。
 *
 * session 来源（2026-08-07 实测结论；V1 Proxy 捕获与 vehicle 载具已归档 archive/）：
 *  登录成功后按优先级取 session：
 *    ① kernel.getMainSession(ctx)（startup 链路 getNTWrapperSession(nt_x)——QQ 主 session，
 *      渲染进程已完成 init → getMsgService READY）
 *    ② get() / qqSession（V1 兼容）
 *  取到后 core.setSession 替换 → waitSessionReady 确认 getMsgService READY。
 */
import { dirname, join } from "node:path";
import { type BootstrapEnv, bootstrapWithCore } from "./bootstrap-core.js";
import { env } from "./env.js";
import type { CoreContextLike, KernelLike } from "./types.js";
import { errMsg, log, type SharedState } from "./util.js";

/** ⭐ appid 动态解析（2026-08-06 P2-0 实测：硬编码 537237765 在 9.9.33 扫码失败
 * 「请下载最新版」；major.node 解析的 537376818 成功）。自研，参考 NapCat 思路。 */
function resolveAppid(kernel: KernelLike, bootEnv: BootstrapEnv): string | number {
    return (
        (typeof kernel.parseAppidFromMajor === "function" &&
            bootEnv.wrapperPath &&
            kernel.parseAppidFromMajor(join(dirname(bootEnv.wrapperPath), "major.node"))) ||
        (typeof kernel.resolveAppidQua === "function" &&
            kernel.resolveAppidQua(bootEnv.qqVersion || "").appid) ||
        "537237765"
    );
}

/** 回退：旧装配路径（startNapuketto + 手工 lifecycle）。 */
async function bootstrapFallback(
    kernel: KernelLike,
    state: SharedState,
    bootEnv: BootstrapEnv,
    Appid: string | number,
): Promise<void> {
    // 回退：旧装配路径（startNapuketto + 手工 lifecycle）
    log("bootstrap: kernel has no NapukettoCore, falling back");
    const ctx: CoreContextLike | undefined = kernel.startNapuketto?.({
        wrapperExports: state.wrapperExports,
        env: { ...bootEnv },
    });
    if (ctx === undefined) {
        log("bootstrap: startNapuketto 不可用");
        return;
    }
    log(
        `bootstrap: startNapuketto OK, engine=${typeof ctx.engine}, session=${ctx.session !== null}`,
    );
    if (
        typeof kernel.quickLogin === "function" &&
        typeof kernel.initAndStartSession === "function"
    ) {
        if (typeof kernel.buildLoginConfig === "function" && ctx.loginService) {
            const loginCfg = kernel.buildLoginConfig(
                Appid as number,
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
            downloadPath: join(bootEnv.dataDir || ".", "temp"),
        });
        const listener = kernel.createLifecycleSessionListener();
        await kernel.initAndStartSession(ctx, sessionConfig, listener, {
            timeoutMs: 20000,
        });
        log("bootstrap: session init + startNT OK!");
    } else {
        log("bootstrap: kernel missing lifecycle fns (quickLogin/initAndStartSession)");
    }
    if (env.NAPUTO_PROBE === "1" && typeof kernel.probeRuntime === "function") {
        try {
            const probe = kernel.probeRuntime(ctx);
            log(
                `bootstrap: probe done, session=${probe.session ? "ok" : "null"}, services=${Object.keys(probe.services ?? {}).length}`,
            );
        } catch (e) {
            log(`bootstrap: probe error: ${errMsg(e)}`);
        }
    }
}

/** 核心引导：import kernel → 装配 → 登录 → 替换 session → 等待就绪 → 协议装配。 */
export async function bootstrap(state: SharedState): Promise<void> {
    const kernelEntry = env.NAPUTO_KERNEL_ENTRY;
    if (!kernelEntry) {
        log("bootstrap: NAPUTO_KERNEL_ENTRY not set");
        return;
    }
    try {
        const kernel = (await import(
            `file://${kernelEntry.replace(/\\/g, "/")}`
        )) as unknown as KernelLike;
        log(`bootstrap: kernel imported, keys: ${Object.keys(kernel).join(", ")}`);
        if (
            typeof kernel.startNapuketto !== "function" &&
            typeof kernel.NapukettoCore !== "function"
        ) {
            log("bootstrap: kernel 无 startNapuketto/NapukettoCore 导出");
            return;
        }
        const bootEnv: BootstrapEnv = {
            qqVersion: env.NAPUTO_QQ_VERSION || "",
            dataDir: env.NAPUTO_CFG_DIR || "",
            wrapperPath: env.NAPUTO_WRAPPER_PATH || "",
        };
        const Appid = resolveAppid(kernel, bootEnv);
        log(`bootstrap: appid=${Appid}（wrapper=${bootEnv.wrapperPath}）`);
        try {
            if (kernel.NapukettoCore !== undefined) {
                await bootstrapWithCore(kernel, state, bootEnv, Appid);
            } else {
                await bootstrapFallback(kernel, state, bootEnv, Appid);
            }
        } catch (e) {
            log(`bootstrap: lifecycle error: ${errMsg(e)}`);
        }
    } catch (e) {
        log(`bootstrap: import kernel failed: ${errMsg(e)}`);
    }
}
