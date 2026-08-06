"use strict";
/**
 * boot-ipc-monitor.js：IPC 监控（V1 排查用，2026-08-05）。
 *
 * 目标：捕获渲染进程 → 主进程的 IPC 消息，定位驱动 cpp_impl 诞生的握手。
 * QQ 9.9.31 把 session 真实初始化下沉到渲染进程，主进程仅作 IPC 转发。
 * V2 载具激活 cpp_impl 后此监控仅作诊断保留（不参与业务链路）。
 */
const { log } = require("./boot-util.js");

const ipcChannels = new Map(); // channel -> 计数

function installIpcMonitor() {
    try {
        const electron = require("electron");
        const ipcMain = electron.ipcMain;
        if (!ipcMain || typeof ipcMain.emit !== "function") {
            log("IPC: electron.ipcMain 不可用（无 emit），跳过监控");
            return;
        }
        log("IPC: electron.ipcMain 可用，安装监控");
        // 打印主进程已注册的接收处理器（EventEmitter 内部表，非逆向）
        try {
            const events = ipcMain._events;
            if (events && typeof events === "object") {
                const names = Object.keys(events);
                log(`IPC: ipcMain 已注册接收处理器 ${names.length} 个: ${names.slice(0, 40).join(",")}`);
            } else {
                log("IPC: ipcMain._events 为空/不可读");
            }
        } catch (e) {
            log(`IPC: _events 读取失败: ${e?.message ?? e}`);
        }
        // webContents 探测（渲染进程注入入口）
        try {
            const wc = electron.BrowserWindow?.getAllWindows?.();
            if (Array.isArray(wc)) {
                log(`IPC: BrowserWindow 数量=${wc.length}`);
                wc.forEach((w, i) => {
                    const id = w.webContents?.id;
                    const url = w.webContents?.getURL?.() ?? "";
                    log(`IPC:   window[${i}] webContents.id=${id} url=${String(url).slice(0, 120)}`);
                });
            } else {
                log("IPC: BrowserWindow.getAllWindows 不可用");
            }
        } catch (e) {
            log(`IPC: BrowserWindow 探测失败: ${e?.message ?? e}`);
        }
        // 全量 channel 监控（去重 + 计数）
        const origEmit = ipcMain.emit;
        ipcMain.emit = function (channel, event, ...args) {
            try {
                const key = String(channel);
                ipcChannels.set(key, (ipcChannels.get(key) ?? 0) + 1);
                // 深挖关键 channel payload（LogApi 刷屏，忽略普通日志）
                const isLogApi = key.startsWith("RM_IPCFROM_RENDERER") &&
                    /LogApi/i.test(JSON.stringify(args[0] ?? "").slice(0, 200));
                if (/wrapper|session|nt|init|login-storage/i.test(key) || (!isLogApi && /RM_IPCFROM/i.test(key))) {
                    const brief = args
                        .map((a) => {
                            try {
                                if (a === null || a === undefined) return String(a);
                                if (typeof a === "string") return a.slice(0, 500);
                                if (typeof a === "number" || typeof a === "boolean") return String(a);
                                return JSON.stringify(a).slice(0, 500);
                            } catch {
                                return `[${typeof a}]`;
                            }
                        })
                        .join(" | ");
                    log(`IPC: [${key}] ${brief}`);
                }
            } catch (e) {
                log(`IPC: 记录失败: ${e?.message ?? e}`);
            }
            return origEmit.apply(this, arguments);
        };
        // 捕获 RM_IPCFROM_RENDERER* 的处理器（ntApi 分发器）——hook ipcMain.on
        try {
            const origOn = ipcMain.on.bind(ipcMain);
            const origOnce = ipcMain.once?.bind(ipcMain);
            const origHandle = ipcMain.handle?.bind(ipcMain);
            ipcMain.on = function (channel, listener) {
                const ret = origOn(channel, listener);
                const key = String(channel);
                if (/RM_IPCFROM|ntApi|wrapper|session/i.test(key)) {
                    log(`IPC: ★ 注册处理器 on(${key}) listener=${listener?.name ?? "anonymous"} 源码=${String(listener).slice(0, 150)}`);
                }
                return ret;
            };
            if (origOnce) {
                ipcMain.once = function (channel, listener) {
                    const ret = origOnce(channel, listener);
                    const key = String(channel);
                    if (/RM_IPCFROM|ntApi|wrapper|session/i.test(key)) {
                        log(`IPC: ★ 注册处理器 once(${key}) listener=${listener?.name ?? "anonymous"}`);
                    }
                    return ret;
                };
            }
            if (origHandle) {
                ipcMain.handle = function (channel, listener) {
                    const ret = origHandle(channel, listener);
                    const key = String(channel);
                    if (/RM_IPCFROM|ntApi|wrapper|session/i.test(key)) {
                        log(`IPC: ★ 注册处理器 handle(${key}) listener=${listener?.name ?? "anonymous"}`);
                    }
                    return ret;
                };
            }
            log("IPC: ipcMain.on/once/handle 已 hook（捕获 ntApi 分发器）");
        } catch (e) {
            log(`IPC: ipcMain.on hook 失败: ${e?.message ?? e}`);
        }
        // 定时打印 webContents URL（观察 UI 是否从 login.html 进入主界面）
        try {
            const injectedIds = new Set();
            const wcTimer = setInterval(() => {
                try {
                    const wins = electron.BrowserWindow?.getAllWindows?.() ?? [];
                    const urls = wins.map(
                        (w) => `#${w.webContents?.id}:${String(w.webContents?.getURL?.() ?? "").slice(0, 100)}`,
                    );
                    log(`IPC: URL 状态 ${urls.join(" ")}`);
                    // 对每个非 login.html 窗口尝试渲染进程注入探测（去重 by webContents.id）
                    for (const w of wins) {
                        const wc = w.webContents;
                        if (!wc) continue;
                        const id = wc.id;
                        const url = String(wc.getURL?.() ?? "");
                        if (url.includes("login.html") || injectedIds.has(id)) continue;
                        injectedIds.add(id);
                        log(`IPC: 尝试渲染进程注入 wc#${id} url=${url.slice(0, 80)}`);
                        wc.executeJavaScript(
                            `(() => {
                                const out = { wc: ${id} };
                                try {
                                    out.globals = Object.keys(window).filter(k => /nt|wrapper|session|QQ/i.test(k)).slice(0, 60);
                                    out.sessType = typeof window.session;
                                    out.qqType = typeof window.QQ;
                                    out.qqntType = typeof window.QQNT;
                                    const s = window.session || window.QQNTWrapperSession;
                                    if (s) {
                                        out.hasGetMsg = typeof s.getMsgService;
                                        try { out.msgSvc = typeof s.getMsgService(); } catch (e) { out.msgErr = String(e); }
                                    }
                                } catch (e) { out.err = String(e); }
                                return JSON.stringify(out);
                            })()`,
                            true,
                        )
                            .then((res) => log(`IPC: 渲染进程 wc#${id} 探测结果: ${String(res).slice(0, 1200)}`))
                            .catch((e) => log(`IPC: executeJavaScript wc#${id} 失败: ${e?.message ?? e}`));
                    }
                } catch (e) {
                    log(`IPC: URL 轮询失败: ${e?.message ?? e}`);
                }
            }, 3000);
            setTimeout(() => clearInterval(wcTimer), 90000);
        } catch (e) {
            log(`IPC: URL 轮询安装失败: ${e?.message ?? e}`);
        }
        // 30s 后打印 channel 汇总
        setTimeout(() => {
            try {
                const sorted = [...ipcChannels.entries()].sort((a, b) => b[1] - a[1]);
                log(
                    `IPC: 汇总（${sorted.length} 个 channel）: ${sorted
                        .map(([k, v]) => `${k}(${v})`)
                        .join(" | ")}`,
                );
            } catch (e) {
                log(`IPC: 汇总失败: ${e?.message ?? e}`);
            }
        }, 30000);
        log("IPC: 监控已安装（等待渲染进程消息）");
    } catch (e) {
        log(`IPC: 安装失败（electron 不可用?）: ${e?.message ?? e}`);
    }
}

module.exports = { installIpcMonitor };
