"use strict";
/**
 * route-b-worker.cjs：路线 B 的 utilityProcess Worker 入口（运行在 QQ 定制 Electron 的
 * utility 子进程中，继承 QQ env）。
 *
 * 职责（2026-08-06 冒烟验证全通）：
 *  1. process.dlopen(wrapper.node) → exports 89 个（QQ env 原生，无需 IAT 改写）
 *  2. 构造 state（wrapperExports）→ 调 boot-bootstrap.js 的 bootstrap(state)
 *     → kernel 装配 → 登录（快速/QR）→ session → 协议装配
 *
 * 对比 V1（boot.cjs 在 QQ 主进程内直接引导）：
 *  - 本 worker 独立进程，主进程只做 fork；worker 崩溃不影响 QQ 主进程
 *  - QQ env 继承 → 事件分发对象天然可用（P0-B 纯 Node 崩溃点在此消失）
 *
 * 由 boot.cjs（主进程）utilityProcess.fork 启动；环境变量继承自主进程。
 */
const { log, createState } = require("./boot-util.js");

const state = createState();

// 日志（boot-util 的 LOG_PATH 指向 NAPUTO_CFG_DIR/napuketto-boot.log，与主进程共用）
log(`[route-b-worker] 启动 @ ${new Date().toISOString()} pid=${process.pid} type=${process.type}`);

const wrapperPath = process.env.NAPUTO_WRAPPER_PATH;
if (!wrapperPath) {
    log("[route-b-worker] NAPUTO_WRAPPER_PATH 未设置，退出");
    process.exit(1);
}

// 1. dlopen wrapper.node（QQ env 原生注册，无需 IAT 改写）
log(`[route-b-worker] dlopen wrapper.node: ${wrapperPath}`);
try {
    const m = { exports: {} };
    process.dlopen(m, wrapperPath);
    const keys = Object.keys(m.exports ?? {});
    log(`[route-b-worker] ✅ dlopen 成功，exports ${keys.length} 个`);
    if (!keys.includes("NodeIKernelLoginService")) {
        log("[route-b-worker] ❌ exports 无 loginService");
        process.exit(1);
    }
    state.wrapperExports = m.exports;
} catch (e) {
    log(`[route-b-worker] ❌ dlopen 失败: ${e?.message ?? e}`);
    process.exit(1);
}

// 2. kernel 引导（复用 boot-bootstrap.js——V1 主进程引导逻辑，worker 内同样适用）
log("[route-b-worker] 调 bootstrap(state) ...");
(async () => {
    try {
        const { bootstrap } = require("./boot-bootstrap.js");
        await bootstrap(state);
        log("[route-b-worker] bootstrap 完成");
        // 常驻：worker 保持存活（协议服务在事件循环上）
        // 注意：不 process.exit（业务运行中）；QQ 主进程退出时 worker 自动终止
    } catch (e) {
        log(`[route-b-worker] bootstrap 失败: ${e?.message ?? e}`);
        process.exit(1);
    }
})();
