"use strict";
/**
 * boot-headless.js：无头模式（V2 载具职责③的 JS 侧部分，纯 Electron 官方 API）。
 *
 * 阻断 BrowserWindow 创建 / GPU 渲染，把 QQ 降到 50MB~100MB 低内存运行。
 *
 * 策略：
 *  1. app.on('browser-window-created') → 立即 destroy 新窗口（主界面不渲染）
 *  2. app.disableHardwareAcceleration() → 关闭 GPU 加速（渲染进程不启动 GPU 进程）
 *  3. 兜底：定时扫描已有窗口并销毁（login.html 也可能占用）
 *
 * 注意：登录流程依赖 login.html 窗口的渲染进程做 session 初始化（V1 观察），
 * 无头在「登录成功 + session 就绪」后才激活——过早阻断会导致登录失败。
 */
const { log } = require("./boot-util.js");

function installHeadlessMode() {
    try {
        const electron = require("electron");
        const app = electron.app;
        const BrowserWindow = electron.BrowserWindow;
        if (!app || typeof app.on !== "function") {
            log("headless: electron.app 不可用，跳过无头");
            return;
        }
        // 关 GPU 加速（渲染进程不再拉起 GPU 进程）
        try {
            app.disableHardwareAcceleration();
            log("headless: hardware acceleration disabled");
        } catch (e) {
            log(`headless: disableHardwareAcceleration 失败: ${e?.message ?? e}`);
        }
        // 新窗口创建即销毁
        const killWindow = (w) => {
            try {
                if (w && !w.isDestroyed()) {
                    w.destroy();
                    log(`headless: destroyed window #${w.id}`);
                }
            } catch (e) {
                log(`headless: destroy 失败: ${e?.message ?? e}`);
            }
        };
        app.on("browser-window-created", (e, w) => {
            log("headless: browser-window-created, destroying");
            killWindow(w);
        });
        // 兜底定时扫描（登录后残留窗口）
        const scanTimer = setInterval(() => {
            try {
                const wins = BrowserWindow?.getAllWindows?.() ?? [];
                for (const w of wins) {
                    killWindow(w);
                }
            } catch {
                // ignore
            }
        }, 5000);
        log("headless: 无头模式已安装（窗口销毁 + 关闭 GPU 加速）");
        // 记录定时器（避免被 GC）
        globalThis.__naputoHeadlessTimer = scanTimer;
    } catch (e) {
        log(`headless: 安装失败: ${e?.message ?? e}`);
    }
}

module.exports = { installHeadlessMode };
