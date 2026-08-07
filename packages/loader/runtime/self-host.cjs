"use strict";
/**
 * self-host.cjs：自建宿主（路线 A，NAPUTO_SELF_HOST）入口——标准 Node 进程直接运行。
 *
 * 背景（2026-08-07 HANDOVER-V6/V9 实测，勿重复探索）：
 *  - 纯 Node（系统 node）+ stub QQNT.dll 转发 + 9.9.33 官方 wrapper.node 可完整登录，
 *    且 session 业务 service 全部 READY（getMsgService 298 方法）。
 *  - 与路线 B（注入 QQ worker，继承 QQ env）不同：标准 node 没有 QQ 的环境与事件分发
 *    对象，必须手动完成三要素：
 *      ① 加载 = stub QQNT.dll 转发（napi_* → node.exe，PATH 前置 stub 目录，
 *         launcher.launchSelfHost 负责装配 PATH）
 *      ② `NodeIO3MiscService.get()` + `addO3MiscListener` 激活事件分发
 *         （否则 getLoginList 永不 resolve——挂起，V6 实测）
 *      ③ commonPath/desktopGlobalPath = 数据根/nt_qq/global（kernel 已按
 *         electronProcessType() !== "browser" 自动解析，见 wrapper-loader.ts）
 *
 * 职责（本文件只做自建宿主特有的引导前置，业务链路完全复用）：
 *  1. process.dlopen(wrapper.node) → exports（98 个，stub 提供宿主符号）
 *  2. O3MiscService 激活事件分发
 *  3. 构造 state（wrapperExports）→ 调 boot-bootstrap.js 的 bootstrap(state)
 *     → kernel 装配 → 登录（快速/QR）→ session（先 init 后 start）→ 冒烟 → 协议装配
 *
 * 由 loader launcher.launchSelfHost() spawn 标准 node 启动；环境变量继承。
 */
const { log, createState } = require("./boot-util.js");

const state = createState();

log(
    `[self-host] 启动 @ ${new Date().toISOString()} pid=${process.pid} node=${process.version} type=${process.type ?? "(标准 node)"}`,
);
log(`[self-host] stub 目录: ${process.env.NAPUTO_STUB_DIR ?? "(PATH 前置，未记录)"}`);

const wrapperPath = process.env.NAPUTO_WRAPPER_PATH;
if (!wrapperPath) {
    log("[self-host] NAPUTO_WRAPPER_PATH 未设置，退出");
    process.exit(1);
}

// 1. dlopen wrapper.node（stub QQNT.dll 转发 napi_*/uv_* → node.exe，标准 node 可注册）
log(`[self-host] dlopen wrapper.node: ${wrapperPath}`);
try {
    const m = { exports: {} };
    process.dlopen(m, wrapperPath);
    const keys = Object.keys(m.exports ?? {});
    log(`[self-host] ✅ dlopen 成功，exports ${keys.length} 个`);
    if (!keys.includes("NodeIKernelLoginService")) {
        log("[self-host] ❌ exports 无 NodeIKernelLoginService（stub 环境异常？）");
        process.exit(1);
    }
    state.wrapperExports = m.exports;
} catch (e) {
    log(`[self-host] ❌ dlopen 失败: ${e?.message ?? e}`);
    process.exit(1);
}

// 2. 🔑 O3MiscService 激活事件分发（自建宿主三要素之二，V6 实测决定性）：
//    不激活则 getLoginList 永不 resolve（挂起）。listener 用普通 JS 对象
//    （getOnAmgomDataPiece 空实现，wrapper 契约回调）。
try {
    const O3 = state.wrapperExports.NodeIO3MiscService;
    if (O3 && typeof O3.get === "function") {
        O3.get().addO3MiscListener({ getOnAmgomDataPiece() {} });
        log("[self-host] ✅ O3MiscService 激活事件分发");
    } else {
        log("[self-host] ⚠️ NodeIO3MiscService 缺失（版本变化？继续尝试）");
    }
} catch (e) {
    log(`[self-host] ⚠️ O3MiscService 激活失败: ${e?.message ?? e}`);
}

// 3. kernel 引导（boot-bootstrap.js 完全复用——登录/initAndStartSession/冒烟/协议装配）
log("[self-host] 调 bootstrap(state) ...");
// void：显式忽略 IIFE promise（内部已 try/catch 兜底，不会 reject）
void (async () => {
    try {
        const { bootstrap } = require("./boot-bootstrap.js");
        await bootstrap(state);
        log("[self-host] bootstrap 完成");
        // 常驻：协议服务在事件循环上；不 process.exit（业务运行中）
    } catch (e) {
        log(`[self-host] bootstrap 失败: ${e?.message ?? e}`);
        process.exit(1);
    }
})();
