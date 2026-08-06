"use strict";
/**
 * boot.cjs：运行在 QQ 定制版 Electron 主进程内（由 hook DLL 引导执行）。
 *
 * 职责：
 *  1. hook process.dlopen：截获 wrapper.node 的 module.exports（QQ preload 注册后）。
 *  2. **Proxy 拦截 exports 构造器的 `new`**：捕获 QQ 自己创建的
 *     NodeIQQNTWrapperSession / NodeIKernelLoginService 实例（2026-08-05 实测确认）。
 *  3. 等 QQ 完成 session init（onSessionInitComplete）后，用**已 init 的 session**
 *     import kernel 启动 Napuketto。
 *
 * 关键认知（2026-08-05 修正）：
 *  - 之前用 startup.create() 创建 session 是**错误**的——那是空 session（service 全 null）。
 *  - QQ 自己会 `new NodeIQQNTWrapperSession()` 并 init/startNT，实例里 service 完整。
 *  - 正确做法：拦截 `new` 窃取 QQ 的 session，等 onSessionInitComplete 后用。
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

// ---- 方向 D：IPC 监控（2026-08-05，纯 Electron 官方 API，合规）----
// 目标：捕获渲染进程 → 主进程的 IPC 消息，定位驱动 cpp_impl 诞生的握手。
// QQ 9.9.31 把 session 真实初始化下沉到渲染进程，主进程仅作 IPC 转发。
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
installIpcMonitor();

/**
 * 无头模式（V2 载具职责③的 JS 侧部分，纯 Electron 官方 API）：
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
// 由环境变量 NAPUTO_HEADLESS=1 控制（launcher 可选注入；V2 载具注入后 boot 侧激活）
if (process.env.NAPUTO_HEADLESS === "1") {
    installHeadlessMode();
}

/**
 * 协议装配：登录成功后，动态 import adapter/network 入口，装配 OB11 适配器。
 * 依赖 launcher 注入的 NAPUTO_ADAPTER_ENTRY / NAPUTO_NETWORK_ENTRY。
 */
async function startProtocols(kernel, ctx, loginResult, logger) {
    const adapterEntry = process.env.NAPUTO_ADAPTER_ENTRY;
    const networkEntry = process.env.NAPUTO_NETWORK_ENTRY;
    if (!adapterEntry || !networkEntry) {
        logger("bootstrap: NAPUTO_ADAPTER_ENTRY/NETWORK_ENTRY 未设置，跳过协议装配");
        return;
    }
    try {
        const network = await import("file://" + networkEntry.replace(/\\/g, "/"));
        const adapter = await import("file://" + adapterEntry.replace(/\\/g, "/"));
        const session = ctx.session;
        if (!session) {
            logger("bootstrap: session 为空，无法装配协议");
            return;
        }
        // 消息事件通道 + 桥
        const channel = new kernel.NTEventChannel("Msg");
        const bridge = new kernel.MsgBridge(session, channel);
        bridge.register();
        // kernel APIs
        const groupApi = new kernel.GroupApi(session);
        const msgApi = new kernel.MsgApi(session);
        const friendApi = new kernel.FriendApi(session, {
            uidToUin: (uids) => groupApi.uidToUin(uids),
        });
        // 群事件通道 + 桥 + 群缓存（ADR-008：事件主动维护 + 查询惰性回填）
        const groupChannel = new kernel.NTEventChannel("Group");
        const groupBridge = new kernel.GroupBridge(session, groupChannel);
        groupBridge.register();
        const groupCache = new kernel.GroupCache({ channel: groupChannel, groupApi });
        groupCache.register();
        const groupNotifyApi = new kernel.GroupNotifyApi(session);
        const ticketApi = new kernel.TicketApi(session);
        const richMediaApi = new kernel.RichMediaApi(session);
        const profileApi = new kernel.ProfileApi(session);
        const profileLikeApi = new kernel.ProfileLikeApi(session);
        // 群空间 web API（Cookie 经 TicketApi.getCookies 注入）
        const webApi = new kernel.WebApi({
            getCookies: (domain) => ticketApi.getCookies(domain, loginResult.uin),
        });
        // network 广播 + OB11 适配器
        const broadcaster = new network.EventBroadcaster();
        // 全局 TOML 配置（<cfgDir>/napuketto.toml）：读 [onebot11] 段，zod 校验后作 seed
        // （ConfigBase seed 模式：load() 直接用内存值，不再读写独立协议文件）
        let ob11Section = {};
        try {
            const cfgFile = path.join(process.env.NAPUTO_CFG_DIR || ".", "napuketto.toml");
            const raw = fs.readFileSync(cfgFile, "utf8");
            const parsed = kernel.parseToml(raw);
            if (parsed && typeof parsed.onebot11 === "object" && parsed.onebot11 !== null) {
                ob11Section = parsed.onebot11;
            }
        } catch (e) {
            logger(`bootstrap: 全局配置读取失败（用默认 ob11 配置）: ${e?.message ?? e}`);
        }
        const ob11Config = new adapter.ProtocolConfig({
            path: path.join(process.env.NAPUTO_CFG_DIR || ".", "napuketto.toml"),
            schema: adapter.ob11ConfigSchema,
            defaults: adapter.ob11ConfigSchema.parse({}),
            seed: adapter.ob11ConfigSchema.parse(ob11Section),
        });
        const ob11 = new adapter.NapukettoOneBot11Adapter({
            config: ob11Config,
            broadcaster,
            msgChannel: channel,
            msgApi,
            groupApi,
            groupNotifyApi,
            friendApi,
            ticketApi,
            richMediaApi,
            profileApi,
            profileLikeApi,
            webApi,
            // P2-16：api/ 聚合（self + system 回调合并为一个对象）
            self: { uin: loginResult.uin, nickname: loginResult.nick },
            system: {
                appVersion: process.env.NAPUTO_QQ_VERSION || "unknown",
                // clean_cache：清理 kernel 数据目录缓存（PathWrapper.clearCache）
                cleanCache: async () => {
                    const paths = new kernel.PathWrapper({
                        dataRoot: process.env.NAPKETTO_DATA,
                        account: loginResult.uin,
                    });
                    paths.clearCache();
                },
                // download_file：缓存目录
                cacheDir: path.join(process.env.NAPUTO_CFG_DIR || ".", "cache"),
                // bot_exit / set_restart：进程控制（退出 QQ 主进程由 launcher 观察）
                exit: async () => {
                    logger("bootstrap: bot_exit 触发，退出 QQ 主进程");
                    process.exit(0);
                },
                restart: async () => {
                    logger("bootstrap: set_restart 触发，退出 QQ 主进程（由 launcher 重启）");
                    process.exit(0);
                },
            },
            // P2-17：群/成员缓存（ADR-008，翻译层只读消费）
            groupCache,
        });
        await ob11.start();
        logger("bootstrap: onebot11 adapter started");
    } catch (e) {
        logger(`bootstrap: 协议装配失败: ${e?.message ?? e}`);
    }
}

log(`boot loaded: node=${process.version} electron=${process.versions.electron ?? "n/a"}`);
log(`cwd: ${process.cwd()}`);
log(`env NAPUTO_BOOT_JS=${process.env.NAPUTO_BOOT_JS}`);

// ---- 捕获状态 ----
let wrapperExports = null;
let qqSession = null;
let qqLoginService = null;

// ---- 拦截 exports 构造器：捕获 QQ 自己创建的 session/loginService 实例 ----
// （QQ 9.9.31 实测：`new NodeIQQNTWrapperSession()` 自建 session 缺 startNT 且
//   init 断言失败（implementation not valid）——QQ 自己 new 的实例才是完整可用。
//   Proxy 必须在 dlopen 返回前装好，才能拦到 preload 后续的 new。）
function installCtorProxies() {
    if (!wrapperExports) return;
    try {
        const S = wrapperExports.NodeIQQNTWrapperSession;
        if (typeof S === "function" && S.__naputoProxied !== true) {
            S.__naputoProxied = true;
            // hook 静态 get() / getNTWrapperSession()（QQ UI 可能用它们拿 session，而非 new）
            try {
                if (typeof S.get === "function") {
                    const origGet = S.get;
                    S.get = function () {
                        const got = origGet.call(this);
                        qqSession = got;
                        log(`BOOT: ⭐ QQ 调 get() 拿到 session（===qqSession? ${got === qqSession}）`);
                        return got;
                    };
                }
            } catch (e) {
                log(`BOOT: get() hook 失败: ${e?.message ?? e}`);
            }
            try {
                if (typeof S.getNTWrapperSession === "function") {
                    const origGetNT = S.getNTWrapperSession;
                    S.getNTWrapperSession = function (name) {
                        const got = origGetNT.call(this, name);
                        qqSession = got;
                        log(`BOOT: ⭐ QQ 调 getNTWrapperSession("${name}") 拿到 session`);
                        return got;
                    };
                }
            } catch (e) {
                log(`BOOT: getNTWrapperSession hook 失败: ${e?.message ?? e}`);
            }
            wrapperExports.NodeIQQNTWrapperSession = new Proxy(S, {
                construct(target, args, newTarget) {
                    const inst = Reflect.construct(target, args, newTarget);
                    qqSession = inst;
                    log(
                        `BOOT: 捕获 QQ session 实例（方法面 ${Object.getOwnPropertyNames(Object.getPrototypeOf(inst) ?? {}).length}）`,
                    );
                    // hook 原型 init（实例属性只读，改原型）：探测 QQ 调 init 的 session
                    try {
                        const proto = Object.getPrototypeOf(inst);
                        if (proto && typeof proto.init === "function" && proto.__naputoInitHooked !== true) {
                            Object.defineProperty(proto, "__naputoInitHooked", {
                                value: true,
                                configurable: true,
                            });
                            const origInit = proto.init;
                            Object.defineProperty(proto, "init", {
                                value: function (cfg, depends, dispatcher, listener) {
                                    log(
                                        `BOOT: ⭐ QQ 调 session.init！cfgKeys=${Object.keys(cfg ?? {}).join(",")} this===qqSession? ${this === qqSession}`,
                                    );
                                    log(
                                        `BOOT:   depends=${depends?.constructor?.name ?? typeof depends} dispatcher=${dispatcher?.constructor?.name ?? typeof dispatcher} listener=${listener?.constructor?.name ?? typeof listener}`,
                                    );
                                    return origInit.apply(this, arguments);
                                },
                                writable: true,
                                configurable: true,
                            });
                            log("BOOT: 原型 init 已 hook（等 QQ 调 init）");
                        }
                    } catch (e) {
                        log(`BOOT: 原型 init hook 失败: ${e?.message ?? e}`);
                    }
                    return inst;
                },
            });
            log("BOOT: session 构造器 Proxy 已安装");
        }
    } catch (e) {
        log(`BOOT: session Proxy 安装失败: ${e?.message ?? e}`);
    }
    try {
        const L = wrapperExports.NodeIKernelLoginService;
        if (typeof L === "function" && L.__naputoProxied !== true) {
            L.__naputoProxied = true;
            wrapperExports.NodeIKernelLoginService = new Proxy(L, {
                construct(target, args, newTarget) {
                    const inst = Reflect.construct(target, args, newTarget);
                    qqLoginService = inst;
                    log("BOOT: 捕获 QQ loginService 实例");
                    return inst;
                },
            });
            log("BOOT: loginService 构造器 Proxy 已安装");
        }
    } catch (e) {
        log(`BOOT: loginService Proxy 安装失败: ${e?.message ?? e}`);
    }
}

// ---- hook process.dlopen 拿 exports（QQ preload 注册后） ----
const dlopenOrig = process.dlopen;
process.dlopen = function (module, filename, flags) {
    const ret = dlopenOrig.call(this, module, filename, flags);
    const fn = String(filename ?? "");
    if (!fn.includes("wrapper.node")) return ret;
    wrapperExports = module.exports;
    log(`CAPTURED wrapper.node exports (${Object.keys(wrapperExports ?? {}).length})`);
    log(`exports keys: ${Object.keys(wrapperExports ?? {}).join(", ")}`);
    installCtorProxies();
    maybeBootstrap();
    return ret;
};

// ---- 等待 exports 就绪 ----
let bootstrapped = false;
function maybeBootstrap() {
    if (bootstrapped) return;
    if (!wrapperExports) return;
    log("wrapper exports ready, starting lifecycle...");
    bootstrap();
}

// 兜底轮询：dlopen hook 可能拿到不完整 exports（首次 dlopen 注册未完成）
const wrapperPath =
    process.env.NAPUTO_WRAPPER_PATH || "C:/Program Files/Tencent/QQNT/versions/9.9.31-49919/resources/app/wrapper.node";

const pollInterval = setInterval(() => {
    if (bootstrapped) {
        clearInterval(pollInterval);
        return;
    }
    try {
        const m = { exports: {} };
        process.dlopen(m, wrapperPath);
        if (m.exports && Object.keys(m.exports).length > 0) {
            wrapperExports = m.exports;
            log(`POLL captured wrapper exports (${Object.keys(wrapperExports).length})`);
            installCtorProxies();
            bootstrap();
        }
    } catch {
        // 未就绪，继续等
    }
}, 500);
// 60s 超时兜底
setTimeout(() => clearInterval(pollInterval), 60000);

function bootstrap() {
    if (bootstrapped) return;
    bootstrapped = true;
    log("bootstrap: importing kernel...");
    const kernelEntry = process.env.NAPUTO_KERNEL_ENTRY;
    if (!kernelEntry) {
        log("bootstrap: NAPUTO_KERNEL_ENTRY not set");
        return;
    }
    try {
        import("file://" + kernelEntry.replace(/\\/g, "/"))
            .then(async (kernel) => {
                log(`bootstrap: kernel imported, keys: ${Object.keys(kernel).join(", ")}`);
                if (typeof kernel.startNapuketto !== "function") {
                    log("bootstrap: kernel has no startNapuketto export");
                    return;
                }
                const bootEnv = {
                    qqVersion: process.env.NAPUTO_QQ_VERSION,
                    dataDir: process.env.NAPUTO_CFG_DIR,
                    wrapperPath: process.env.NAPUTO_WRAPPER_PATH,
                };
                try {
                    if (typeof kernel.NapukettoCore === "function") {
                        // 装配层路径：NapukettoCore.create → attachWrapper → login
                        const core = kernel.NapukettoCore.create({
                            paths: { dataRoot: bootEnv.dataDir },
                            logLevel: "info",
                        });
                        // 不传 qqSession/qqLoginService（登录前捕获的旧实例已失效/会干扰；
                        // framework 语义：登录成功后 kernel 自己 create+init）
                        const ctx = core.attachWrapper(wrapperExports, bootEnv);
                        log(
                            `bootstrap: attachWrapper OK, engine=${typeof ctx.engine}, session=${ctx.session !== null}`,
                        );
                        // 探测：create() 与捕获的 QQ session 关系（确认 create() 是否干扰 QQ）
                        try {
                            const S2 = wrapperExports.NodeIQQNTWrapperSession;
                            const created = typeof S2.create === "function" ? S2.create() : null;
                            log(
                                `BOOT: create()===qqSession? ${created === qqSession} | create()===ctx.session? ${created === ctx.session} | qqSession===ctx.session? ${qqSession === ctx.session}`,
                            );
                            const svc =
                                created && typeof created.getMsgService === "function"
                                    ? created.getMsgService()
                                    : null;
                            log(
                                `BOOT: create().getMsgService=${svc !== null && svc !== undefined ? "ready" : "null"} qqSession.getMsgService=${qqSession && typeof qqSession.getMsgService === "function" && qqSession.getMsgService() !== null && qqSession.getMsgService() !== undefined ? "ready" : "null"}`,
                            );
                        } catch (e) {
                            log(`BOOT: create() 探测失败: ${e?.message ?? e}`);
                        }
                        // 多源 session 就绪探测：qqSession / get() / getNTWrapperSession（5s 间隔，60s 上限）
                        const sessionProbe = setInterval(() => {
                            try {
                                const S2 = wrapperExports.NodeIQQNTWrapperSession;
                                const out = [];
                                if (qqSession && typeof qqSession.getMsgService === "function") {
                                    const svc = qqSession.getMsgService();
                                    out.push(`qqSession=${svc !== null && svc !== undefined ? "READY" : "null"}`);
                                }
                                if (typeof S2.get === "function") {
                                    const got = S2.get();
                                    if (got && typeof got.getMsgService === "function") {
                                        const svc = got.getMsgService();
                                        out.push(`get()=${svc !== null && svc !== undefined ? "READY" : "null"}${got === qqSession ? "(=qqSession)" : ""}`);
                                    } else {
                                        out.push("get()=无效");
                                    }
                                }
                                log(`BOOT: session 探测: ${out.join(" | ")}`);
                            } catch (e) {
                                log(`BOOT: session 探测失败: ${e?.message ?? e}`);
                            }
                        }, 5000);
                        setTimeout(() => clearInterval(sessionProbe), 60000);
                        // 探测 session 方法面（NAPI 反射，验证 startNT/init 等关键方法）
                        try {
                            const s = ctx.session;
                            if (s) {
                                const names = [
                                    ...Object.getOwnPropertyNames(Object.getPrototypeOf(s) ?? {}),
                                    ...Object.keys(s ?? {}),
                                ];
                                log(
                                    `bootstrap: session methods(${names.length}): ${[...new Set(names)].join(", ")}`,
                                );
                                log(
                                    `bootstrap: session.init=${typeof s.init} startNT=${typeof s.startNT} getMsgService=${typeof s.getMsgService}`,
                                );
                            }
                        } catch (e) {
                            log(`bootstrap: session 探测失败: ${e?.message ?? e}`);
                        }
                        let loginResult = null;
                        if (typeof core.login === "function") {
                            // 打印可用快速登录账号（启动横幅）
                            try {
                                const accounts = await kernel.listLoginAccounts(ctx);
                                if (accounts.length > 0) {
                                    log(`可用于快速登录 of QQ（${accounts.length} 个）：`);
                                    accounts.forEach((acct, idx) => {
                                        const nick = acct.nickName || acct.uin;
                                        const marker = acct.isQuickLogin ? "（默认）" : "";
                                        log(`${idx + 1}. ${acct.uin} ${nick}${marker}`);
                                    });
                                    const target =
                                        accounts.find((a) => a.isQuickLogin) ?? accounts[0];
                                    log(`正在快速登录 ${target.uin}`);
                                } else {
                                    log("没有历史登录账号，将使用二维码登录方式");
                                }
                            } catch (listErr) {
                                log(`bootstrap: 获取登录列表失败: ${listErr?.message ?? listErr}`);
                            }
                            try {
                                loginResult = await core.login({
                                    appid: "537237765",
                                    initTimeoutMs: 20000,
                                });
                            } catch (loginErr) {
                                // 快速登录失败 → QR 回退（二维码写缓存目录，boot 日志提示）
                                log(`bootstrap: 快速登录失败（${loginErr?.message ?? loginErr}），尝试 QR 登录`);
                                loginResult = await core.login({
                                    appid: "537237765",
                                    initTimeoutMs: 20000,
                                    qrFallback: true,
                                });
                            }
                            log(
                                `bootstrap: 登录成功 uin=${loginResult.uin} uid=${loginResult.uid} nick=${loginResult.nick}`,
                            );
                            // ⭐ 登录后替换 session：Proxy 捕获的 QQ 新实例（登录后重建）才有效，
                            // 替换 kernel 登录时自建的 session（framework 语义）。
                            // 候选来源：construct / get() / getNTWrapperSession 捕获的 qqSession。
                            if (typeof core.setSession === "function") {
                                let replaced = false;
                                for (let i = 0; i < 20; i++) {
                                    if (qqSession && qqSession !== ctx.session) {
                                        // 验证候选 session 是否有效（getMsgService 可调，不抛断言）
                                        let usable = false;
                                        try {
                                            const svc = qqSession.getMsgService();
                                            usable = svc !== null && svc !== undefined;
                                        } catch {
                                            usable = false;
                                        }
                                        if (usable) {
                                            core.setSession(qqSession);
                                            replaced = true;
                                            log(
                                                `bootstrap: 已替换为 QQ 登录后 session（getMsgService READY）`,
                                            );
                                            break;
                                        }
                                        log(
                                            `bootstrap: qqSession 捕获但未就绪（getMsgService=${usable ? "ready" : "null/断言"}），继续等待`,
                                        );
                                    }
                                    await new Promise((r) => setTimeout(r, 500));
                                }
                                if (!replaced) {
                                    log("bootstrap: 未捕获到可用的登录后 qqSession，保留 kernel 自建 session");
                                }
                            }
                            // 等 session 就绪（getMsgService 非 null）——QQ 完成 init 后才有
                            try {
                                await kernel.waitSessionReady(ctx, { timeoutMs: 30000 });
                                log("bootstrap: QQ session 就绪（getMsgService 可用）");
                            } catch (readyErr) {
                                log(
                                    `bootstrap: 等待 session 就绪失败: ${readyErr?.message ?? readyErr}`,
                                );
                            }
                        } else {
                            log("bootstrap: kernel core missing login fn");
                        }
                        // 协议装配（adapter + network，登录成功后）
                        if (loginResult !== null) {
                            await startProtocols(kernel, ctx, loginResult, log);
                        }
                        // 探测模式
                        if (process.env.NAPUTO_PROBE === "1" && typeof kernel.probeRuntime === "function") {
                            try {
                                const probe = kernel.probeRuntime(ctx);
                                log(
                                    `bootstrap: probe done, session=${probe.session ? "ok" : "null"}, services=${Object.keys(probe.services ?? {}).length}`,
                                );
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
                    } else {
                        // 回退：旧装配路径（startNapuketto + 手工 lifecycle）
                        log("bootstrap: kernel has no NapukettoCore, falling back");
                        const ctx = kernel.startNapuketto({
                            wrapperExports,
                            env: bootEnv,
                        });
                        log(
                            `bootstrap: startNapuketto OK, engine=${typeof ctx.engine}, session=${ctx.session !== null}`,
                        );
                        if (typeof kernel.quickLogin === "function" &&
                            typeof kernel.initAndStartSession === "function") {
                            if (typeof kernel.buildLoginConfig === "function" && ctx.loginService) {
                                const loginCfg = kernel.buildLoginConfig(
                                    "537237765",
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
                                appid: "537237765",
                                fullVersion: bootEnv.qqVersion || "",
                                selfUin: loginResult.uin,
                                selfUid: loginResult.uid,
                                accountPath: bootEnv.dataDir || ".",
                                downloadPath: path.join(bootEnv.dataDir || ".", "temp"),
                            });
                            const listener = kernel.createLifecycleSessionListener();
                            await kernel.initAndStartSession(ctx, sessionConfig, listener, { timeoutMs: 20000 });
                            log("bootstrap: session init + startNT OK!");
                        } else {
                            log("bootstrap: kernel missing lifecycle fns (quickLogin/initAndStartSession)");
                        }
                        if (process.env.NAPUTO_PROBE === "1" && typeof kernel.probeRuntime === "function") {
                            try {
                                const probe = kernel.probeRuntime(ctx);
                                log(
                                    `bootstrap: probe done, session=${probe.session ? "ok" : "null"}, services=${Object.keys(probe.services ?? {}).length}`,
                                );
                            } catch (e) {
                                log(`bootstrap: probe error: ${e?.message ?? e}`);
                            }
                        }
                    }
                } catch (e) {
                    log(`bootstrap: lifecycle error: ${e?.message ?? e}`);
                }
            })
            .catch((e) => {
                log(`bootstrap: import kernel failed: ${e.message}`);
            });
    } catch (e) {
        log(`bootstrap: error: ${e.message}`);
    }
}

log("boot ready, waiting for wrapper exports...");
