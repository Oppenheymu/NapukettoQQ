/**
 * self-host.ts：自建宿主（路线 A，NAPUTO_SELF_HOST）入口——标准 Node 进程直接运行。
 * 2026-08-07 阶段 2：由 runtime/self-host.cjs TS 化（零语义改动）。
 * 由 loader launcher.launchSelfHost() spawn 标准 node 启动；环境变量继承。
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
 *  3. 构造 state（wrapperExports）→ 调 bootstrap(state)
 *     → kernel 装配 → 登录（快速/QR）→ session（先 init 后 start）→ 冒烟 → 协议装配
 */

import { acquireInstanceLock, checkInstanceLock, registerLockCleanup } from "../instance-lock.js";
import { bootstrap } from "./bootstrap.js";
import { env } from "./env.js";
import { createState, errMsg, log } from "./util.js";

const state = createState();

log(
    `[self-host] 启动 @ ${new Date().toISOString()} pid=${process.pid} node=${process.version} type=${(process as { type?: string }).type ?? "(标准 node)"}`,
);
log(`[self-host] stub 目录: ${env.NAPUTO_STUB_DIR ?? "(PATH 前置，未记录)"}`);

// 0. 单实例锁兜底（2026-08-07 根治）：数据目录粒度锁——同一账号数据目录
//    只允许一个实例（QQ 原生层 MMKV/登录单例有锁，第二个实例抢不到会挂起）。
//    cli 已做启动前检测，此处防 supervisor/直接跑 self-host 绕过 cli 的路径。
//    NAPUTO_CFG_DIR 即账号数据目录（launcher 注入）。
const lockDataDir = env.NAPUTO_CFG_DIR;
if (lockDataDir) {
    if (!acquireInstanceLock(lockDataDir)) {
        const { pid: holderPid } = checkInstanceLock(lockDataDir);
        log(
            `[self-host] ❌ 数据目录已被其他实例占用（pid=${holderPid ?? "?"}），退出；` +
                "同一账号数据目录仅允许一个实例，请先停止已有实例",
        );
        process.exit(1);
    }
    registerLockCleanup(lockDataDir);
    log(`[self-host] ✅ 已获取数据目录锁（${lockDataDir}）`);
} else {
    log("[self-host] ⚠️ NAPUTO_CFG_DIR 未设置，跳过单实例锁");
}

const wrapperPath = env.NAPUTO_WRAPPER_PATH;
if (!wrapperPath) {
    log("[self-host] NAPUTO_WRAPPER_PATH 未设置，退出");
    process.exit(1);
}

// 1. dlopen wrapper.node（stub QQNT.dll 转发 napi_*/uv_* → node.exe，标准 node 可注册）
log(`[self-host] dlopen wrapper.node: ${wrapperPath}`);
try {
    // { exports: {} } 是 process.dlopen 的最小载体（wrapper 向其中填充 NAPI exports）
    const m: { exports: Record<string, unknown> } = { exports: {} };
    process.dlopen(m as object, wrapperPath);
    const keys = Object.keys(m.exports ?? {});
    log(`[self-host] ✅ dlopen 成功，exports ${keys.length} 个`);
    if (!keys.includes("NodeIKernelLoginService")) {
        log("[self-host] ❌ exports 无 NodeIKernelLoginService（stub 环境异常？）");
        process.exit(1);
    }
    state.wrapperExports = m.exports;
} catch (e) {
    log(`[self-host] ❌ dlopen 失败: ${errMsg(e)}`);
    process.exit(1);
}

// 2. 🔑 O3MiscService 激活事件分发（自建宿主三要素之二，V6 实测决定性）：
//    不激活则 getLoginList 永不 resolve（挂起）。listener 用普通 JS 对象
//    （getOnAmgomDataPiece 空实现，wrapper 契约回调）。
try {
    const O3 = state.wrapperExports?.["NodeIO3MiscService"] as
        | { get?(): { addO3MiscListener(listener: unknown): void } }
        | undefined;
    if (O3 && typeof O3.get === "function") {
        O3.get().addO3MiscListener({ getOnAmgomDataPiece() {} });
        log("[self-host] ✅ O3MiscService 激活事件分发");
    } else {
        log("[self-host] ⚠️ NodeIO3MiscService 缺失（版本变化？继续尝试）");
    }
} catch (e) {
    log(`[self-host] ⚠️ O3MiscService 激活失败: ${errMsg(e)}`);
}

// 3. kernel 引导（bootstrap.ts 完全复用——登录/initAndStartSession/冒烟/协议装配）
log("[self-host] 调 bootstrap(state) ...");
// void：显式忽略 IIFE promise（内部已 try/catch 兜底，不会 reject）
void (async () => {
    try {
        await bootstrap(state);
        log("[self-host] bootstrap 完成");
        // 常驻：协议服务在事件循环上；不 process.exit（业务运行中）
    } catch (e) {
        log(`[self-host] bootstrap 失败: ${errMsg(e)}`);
        process.exit(1);
    }
})();
