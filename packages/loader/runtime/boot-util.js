"use strict";
/**
 * boot-util.js：引导公共工具（日志 + 共享状态）。
 * 由 self-host.cjs 及各拆分模块 require（CJS，运行在自建宿主引导进程内）。
 */
const fs = require("node:fs");
const path = require("node:path");

/** boot 日志路径（NAPUTO_CFG_DIR 下，与 vehicle/hookdll 日志同目录）。 */
const LOG_PATH = process.env.NAPUTO_CFG_DIR
    ? path.join(process.env.NAPUTO_CFG_DIR, "napuketto-boot.log")
    : path.join(require("node:os").tmpdir(), "napuketto-boot.log");

/** 追加一行 boot 日志（失败静默，不阻塞引导）。 */
function log(msg) {
    try {
        fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`);
    } catch {
        // ignore
    }
}

/** 共享状态（boot.cjs 主入口创建，各拆分模块读写）：
 *  - wrapperExports：dlopen 截获的 wrapper.node exports
 *  - qqSession / qqLoginService：Proxy 捕获的 QQ 实例（V1 路线）
 *  - bootstrapped：kernel 引导是否已启动（防重入） */
function createState() {
    return {
        wrapperExports: null,
        qqSession: null,
        qqLoginService: null,
        bootstrapped: false,
    };
}

module.exports = { LOG_PATH, log, createState };
