"use strict";
/**
 * boot-headless.js：无头模式（V2 载具职责③的 JS 侧部分，纯 Electron 官方 API）。
 *
 * 阻断 BrowserWindow 创建 / GPU 渲染，把 QQ 降到 50MB~100MB 低内存运行。
 *
 * 策略：
 *  1. app.commandLine.appendSwitch('disable-gpu') → 进程级关闭 GPU（早于 app ready）
 *  2. app.disableHardwareAcceleration() → 渲染进程不再拉起 GPU 进程
 *  3. app.on('browser-window-created') → **延迟 hide()**（只隐藏不销毁）
 *  4. 兜底：定时扫描已有窗口并隐藏（login.html 也可能占用）
 *
 * ⚠️ 崩溃教训（2026-08-06）：browser-window-created 事件回调里**同步 destroy()**
 * 会导致 QQ 崩溃（0xC0000005）——回调路径上 QQ 主进程持窗口/渲染进程指针，
 * 同步销毁 = use-after-free；且渲染进程被杀会断开登录 IPC 链路。改为延迟 hide()：
 * 窗口不可见（不弹界面）但渲染进程保留（登录正常），QQ 不崩。
 *
 * V2（2026-08-06）：vehicle 载具激活 cpp_impl 后主进程已有有效 session，渲染进程
 * 不再是业务必需——hide 只是当前阶段「不弹窗 + 不崩溃」的最稳方案；真正降内存
 * （阻断 webContents 创建/杀渲染进程）留给后续 C++ 侧进程级阻断。
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
        // 进程级禁用 GPU：必须早于 app ready。boot.cjs 在 dlopen hook 时执行（早于
        // Electron app ready），满足时序。
        try {
            app.commandLine.appendSwitch("disable-gpu");
            app.commandLine.appendSwitch("disable-gpu-compositing");
            log("headless: commandLine disable-gpu 已追加");
        } catch (e) {
            log(`headless: commandLine appendSwitch 失败: ${e?.message ?? e}`);
        }
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
        log("headless: 无头模式已安装（disable-gpu + 窗口延迟隐藏）");
        // 记录定时器（避免被 GC）
        globalThis.__naputoHeadlessTimer = scanTimer;
    } catch (e) {
        log(`headless: 安装失败: ${e?.message ?? e}`);
    }
}

module.exports = { installHeadlessMode };
