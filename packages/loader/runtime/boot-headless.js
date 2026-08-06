"use strict";
/**
 * boot-headless.js：无头模式（V2 载具职责③的 JS 侧部分，纯 Electron 官方 API）。
 *
 * 阻断 BrowserWindow 创建 / GPU 渲染 / 辅助渲染进程，把 QQ 降到低内存运行。
 *
 * 策略（2026-08-06 增强）：
 *  1. app.commandLine.appendSwitch 低内存开关组（双保险；真正生效靠 bootmain
 *     CreateProcess 命令行 NAPUTO_QQ_ARGS——appendSwitch 时序太晚，GPU 进程在
 *     app ready 前已 fork，实测 disable-gpu 后 gpu-process 仍在）
 *  2. app.disableHardwareAcceleration() → 渲染进程不再拉起 GPU 进程
 *  3. app.on('browser-window-created') → 延迟 hide()（只隐藏不销毁）
 *  4. **深度无头（NAPUTO_DEEP_HEADLESS=1）**：webContents.forcefullyCrashRenderer()
 *     压制非关键渲染进程（screenshot/blank）——杀进程但不 destroy 窗口对象，
 *     不触发 use-after-free 崩溃。主窗口（main/message、login）与 hiddenWindow
 *     （进程池基础）绝不动——它们是登录/init IPC 的载体。
 *
 * ⚠️ 崩溃教训（2026-08-06）：browser-window-created 事件回调里**同步 destroy()**
 * 会导致 QQ 崩溃（0xC0000005）——回调路径上 QQ 主进程持窗口/渲染进程指针，
 * 同步销毁 = use-after-free；且渲染进程被杀会断开登录 IPC 链路。
 * → 窗口一律延迟 hide（不 destroy）；杀渲染进程用 forcefullyCrashRenderer
 *   （webContents 对象保留，仅进程退出释放内存）。
 */
const { log } = require("./boot-util.js");

/** 主窗口（登录/init IPC 载体）——绝不动。 */
const MAIN_URL = /main\/message|login\.html/;
/** 进程池基础窗口（QQ 渲染进程调度依赖）——不杀（怕崩）。 */
const HIDDEN_URL = /hiddenWindow/;
/** 可压制的辅助渲染进程（纯 UI 负担，机器人不需要）。 */
const KILLABLE_URL = /screenshot\.html|index\.html\?.*blank/;

function installHeadlessMode() {
    try {
        const electron = require("electron");
        const app = electron.app;
        const BrowserWindow = electron.BrowserWindow;
        if (!app || typeof app.on !== "function") {
            log("headless: electron.app 不可用，跳过无头");
            return;
        }
        // 低内存开关组（双保险；真正生效靠 bootmain 命令行 NAPUTO_QQ_ARGS）
        const switches = [
            "disable-gpu",
            "disable-gpu-compositing",
            "disable-software-rasterizer",
            "disable-dev-shm-usage",
        ];
        for (const s of switches) {
            try {
                app.commandLine.appendSwitch(s);
            } catch (e) {
                log(`headless: appendSwitch(${s}) 失败: ${e?.message ?? e}`);
            }
        }
        try {
            app.commandLine.appendSwitch("js-flags", "--max-old-space-size=384");
        } catch (e) {
            log(`headless: appendSwitch(js-flags) 失败: ${e?.message ?? e}`);
        }
        log(`headless: commandLine 低内存开关已追加（${switches.join(", ")}, js-flags）`);
        // 关 GPU 加速（渲染进程不再拉起 GPU 进程）
        try {
            app.disableHardwareAcceleration();
            log("headless: hardware acceleration disabled");
        } catch (e) {
            log(`headless: disableHardwareAcceleration 失败: ${e?.message ?? e}`);
        }
        // 隐藏窗口：延迟到事件回调外执行（同步 hide 也可能在回调路径上出问题），
        // 且只 hide 不 destroy——渲染进程保留，登录 IPC 不断，QQ 不崩。
        const hideWindow = (w) => {
            try {
                if (w && !w.isDestroyed()) {
                    // 已有可见窗口先隐藏（登录后可能重建可见状态）
                    if (w.isVisible()) {
                        w.hide();
                        log(`headless: hidden window #${w.id}`);
                    } else {
                        log(`headless: window #${w.id} 已隐藏，跳过`);
                    }
                }
            } catch (e) {
                log(`headless: hide 失败: ${e?.message ?? e}`);
            }
        };
        app.on("browser-window-created", (e, w) => {
            log(`headless: browser-window-created #${w.id}, scheduling hide`);
            // 延迟隐藏：避开事件回调同步路径（QQ 内部可能正在初始化该窗口）
            setTimeout(() => hideWindow(w), 300);
        });
        // 兜底定时扫描（登录后残留窗口）
        const scanTimer = setInterval(() => {
            try {
                const wins = BrowserWindow?.getAllWindows?.() ?? [];
                for (const w of wins) {
                    hideWindow(w);
                }
            } catch {
                // ignore
            }
        }, 3000);
        log("headless: 无头模式已安装（低内存开关 + 窗口延迟隐藏）");
        // 记录定时器（避免被 GC）
        globalThis.__naputoHeadlessTimer = scanTimer;

        // ---- 深度无头（NAPUTO_DEEP_HEADLESS=1）：压制非关键渲染进程 ----
        if (process.env.NAPUTO_DEEP_HEADLESS === "1") {
            installDeepHeadless(electron, BrowserWindow);
        }
    } catch (e) {
        log(`headless: 安装失败: ${e?.message ?? e}`);
    }
}

/**
 * 深度无头：压制非关键渲染进程（screenshot/blank），释放其内存。
 * 用 webContents.forcefullyCrashRenderer()——杀渲染进程但保留 webContents/BrowserWindow
 * 对象（不 destroy → 不触发 use-after-free 崩溃）。QQ 可能重建窗口 → 持续压制（按 wc.id 去重）。
 */
function installDeepHeadless(electron, BrowserWindow) {
    try {
        const crashed = new Set(); // webContents.id 去重（避免反复 crash 刷日志）
        const classifyUrl = (url) => {
            const u = String(url ?? "");
            if (MAIN_URL.test(u)) return "main";
            if (HIDDEN_URL.test(u)) return "hidden";
            if (KILLABLE_URL.test(u)) return "killable";
            return "other";
        };
        const crush = () => {
            try {
                const wins = BrowserWindow?.getAllWindows?.() ?? [];
                for (const w of wins) {
                    const wc = w?.webContents;
                    if (!wc || wc.isDestroyed()) continue;
                    const url = String(wc.getURL?.() ?? "");
                    const kind = classifyUrl(url);
                    if (kind !== "killable") continue;
                    if (crashed.has(wc.id)) continue;
                    crashed.add(wc.id);
                    try {
                        wc.forcefullyCrashRenderer();
                        log(`headless-deep: 已压制渲染进程 wc#${wc.id} (${url.slice(0, 90)})`);
                    } catch (e) {
                        log(`headless-deep: crash wc#${wc.id} 失败: ${e?.message ?? e}`);
                    }
                }
            } catch {
                // ignore
            }
        };
        const crushTimer = setInterval(crush, 3000);
        globalThis.__naputoDeepHeadlessTimer = crushTimer;
        log("headless-deep: 深度无头已安装（压制 screenshot/blank 渲染进程，保留 main/login/hidden）");
        // 首次立即压一轮
        setTimeout(crush, 1500);
    } catch (e) {
        log(`headless-deep: 安装失败: ${e?.message ?? e}`);
    }
}

module.exports = { installHeadlessMode };
