"use strict";
/**
 * boot.cjs：运行在 QQ 定制版 Electron 主进程内（由 hook DLL 引导执行）——入口模块。
 *
 * 职责：
 *  1. hook process.dlopen：截获 wrapper.node 的 module.exports（QQ preload 注册后）。
 *  2. **Proxy 拦截 exports 构造器的 `new`**：捕获 QQ 自己创建的 session/loginService（V1 路线）。
 *  3. wrapper exports 就绪后，import kernel 启动 Napuketto（引导核心见 boot-bootstrap.js）。
 *
 * 关键认知（2026-08-05 修正）：
 *  - 之前用 startup.create() 创建 session 是**错误**的——那是空 session（service 全 null）。
 *  - QQ 自己会 `new NodeIQQNTWrapperSession()` 并 init/startNT，实例里 service 完整。
 *  - V2（2026-08-06）：vehicle 载具 C++ 侧创建+注册 session（单例表），boot 登录后
 *    从单例表 get() 取激活 session 替换（见 boot-bootstrap.js）。
 *
 * 模块结构（2026-08-06 拆分，原 806 行 → 6 个文件）：
 *  - boot.cjs            本文件：入口 + dlopen 截获 + Proxy 捕获 + 调度
 *  - boot-util.js        日志 + 共享状态
 *  - boot-ipc-monitor.js IPC 监控（V1 排查保留）
 *  - boot-headless.js    无头模式（阻断 UI/GPU）
 *  - boot-protocols.js   协议装配（OB11 adapter + network）
 *  - boot-bootstrap.js   kernel 引导 + 登录 + session 替换 + 探测
 */

const { log, createState } = require("./boot-util.js");
const { installIpcMonitor } = require("./boot-ipc-monitor.js");
const { installHeadlessMode } = require("./boot-headless.js");

// ---- 共享状态（boot-util 创建，各模块读写）----
const state = createState();

// ---- 方向 D：IPC 监控（2026-08-05，纯 Electron 官方 API，合规；V2 诊断保留）----
installIpcMonitor();

/**
 * 无头模式（V2 载具职责③的 JS 侧部分，纯 Electron 官方 API）：
 * 由环境变量 NAPUTO_HEADLESS=1 控制（cli 默认开启；launcher 透传）。
 *
 * V2（2026-08-06）：vehicle 载具激活 cpp_impl 后主进程已有有效 session，渲染进程
 * 不再是必需——无头可全程生效（QQ 界面不弹出，登录走主进程 NAPI 快速登录/QR 文件）。
 * 具体策略见 boot-headless.js（disable-gpu + 窗口创建即销毁 + 定时扫描）。
 */
if (process.env.NAPUTO_HEADLESS === "1") {
    installHeadlessMode();
}

log(`boot loaded: node=${process.version} electron=${process.versions.electron ?? "n/a"}`);
log(`cwd: ${process.cwd()}`);
log(`env NAPUTO_BOOT_JS=${process.env.NAPUTO_BOOT_JS}`);

// ---- 路线 B（2026-08-06）：utilityProcess Worker 模式 ----
// NAPUTO_ROUTE_B=1 时，boot 脚本不再直接 dlopen/引导，而是 fork utilityProcess
// Worker（继承 QQ env）→ worker 内 dlopen wrapper.node → bootstrap。
// QQ env 提供事件分发对象 → P0-B 纯 Node 崩溃点消失（冒烟已验证登录链路全通）。
// Worker 独立进程：主进程只做 fork + 保持存活（QQ 退出时 worker 自动终止）。
if (process.env.NAPUTO_ROUTE_B === "1") {
    const { log: logB, createState: createStateB } = require("./boot-util.js");
    logB("boot: 路线 B 模式——fork utilityProcess Worker");

    // 解析 electron.utilityProcess（QQ 主进程内可用）
    let electron = null;
    try {
        electron = require("electron");
    } catch (e) {
        logB(`boot: require("electron") 失败: ${e?.message ?? e}`);
    }
    if (!electron || typeof electron.utilityProcess?.fork !== "function") {
        logB("boot: ❌ electron.utilityProcess.fork 不可用，回退 V1 直接引导");
    } else {
        const workerPath = require("node:path").join(__dirname, "route-b-worker.cjs");
        logB(`boot: fork worker ${workerPath}`);
        try {
            const worker = electron.utilityProcess.fork(workerPath, [], { stdio: "pipe" });
            worker.on("exit", (code) => {
                logB(`boot: worker exit code=${code}`);
            });
            worker.on("error", (e) => {
                logB(`boot: worker error: ${e?.message ?? e}`);
            });
            // 主进程保持存活（QQ 事件循环运行中；QQ 退出时 worker 自动终止）
            // 注意：不 process.exit——QQ 主进程生命周期由 QQ 自身管理
            logB("boot: worker forked，主进程保持存活");
            // 主进程不再走 V1 引导，直接挂起（后续 worker 完成一切）。
            // CJS 顶层 return 合法（模块被包在 Module wrapper 函数里），
            // 阻止下方 V1 的 dlopen 拦截/boot-bootstrap 逻辑执行。
            return;
        } catch (e) {
            logB(`boot: fork 失败: ${e?.message ?? e}，回退 V1 直接引导`);
        }
    }
}

// ---- 拦截 exports 构造器：捕获 QQ 自己创建的 session/loginService 实例 ----
// （QQ 9.9.31 实测：`new NodeIQQNTWrapperSession()` 自建 session 缺 startNT 且
//   init 断言失败（implementation not valid）——QQ 自己 new 的实例才是完整可用。
//   Proxy 必须在 dlopen 返回前装好，才能拦到 preload 后续的 new。）
function installCtorProxies() {
    if (!state.wrapperExports) return;
    try {
        const S = state.wrapperExports.NodeIQQNTWrapperSession;
        if (typeof S === "function" && S.__naputoProxied !== true) {
            S.__naputoProxied = true;
            // hook 静态 get() / getNTWrapperSession()（QQ UI 可能用它们拿 session，而非 new）
            try {
                if (typeof S.get === "function") {
                    const origGet = S.get;
                    S.get = function () {
                        const got = origGet.call(this);
                        state.qqSession = got;
                        log(`BOOT: ⭐ QQ 调 get() 拿到 session（===qqSession? ${got === state.qqSession}）`);
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
                        state.qqSession = got;
                        log(`BOOT: ⭐ QQ 调 getNTWrapperSession("${name}") 拿到 session`);
                        return got;
                    };
                }
            } catch (e) {
                log(`BOOT: getNTWrapperSession hook 失败: ${e?.message ?? e}`);
            }
            state.wrapperExports.NodeIQQNTWrapperSession = new Proxy(S, {
                construct(target, args, newTarget) {
                    const inst = Reflect.construct(target, args, newTarget);
                    state.qqSession = inst;
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
                                        `BOOT: ⭐ QQ 调 session.init！cfgKeys=${Object.keys(cfg ?? {}).join(",")} this===qqSession? ${this === state.qqSession}`,
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
        const L = state.wrapperExports.NodeIKernelLoginService;
        if (typeof L === "function" && L.__naputoProxied !== true) {
            L.__naputoProxied = true;
            state.wrapperExports.NodeIKernelLoginService = new Proxy(L, {
                construct(target, args, newTarget) {
                    const inst = Reflect.construct(target, args, newTarget);
                    state.qqLoginService = inst;
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
    state.wrapperExports = module.exports;
    log(`CAPTURED wrapper.node exports (${Object.keys(state.wrapperExports ?? {}).length})`);
    log(`exports keys: ${Object.keys(state.wrapperExports ?? {}).join(", ")}`);
    installCtorProxies();
    maybeBootstrap();
    return ret;
};

// ---- 等待 exports 就绪 ----
function maybeBootstrap() {
    if (state.bootstrapped) return;
    if (!state.wrapperExports) return;
    log("wrapper exports ready, starting lifecycle...");
    state.bootstrapped = true;
    bootstrapAsync();
}

// 兜底轮询：dlopen hook 可能拿到不完整 exports（首次 dlopen 注册未完成）
const wrapperPath =
    process.env.NAPUTO_WRAPPER_PATH || "C:/Program Files/Tencent/QQNT/versions/9.9.31-49919/resources/app/wrapper.node";

const pollInterval = setInterval(() => {
    if (state.bootstrapped) {
        clearInterval(pollInterval);
        return;
    }
    try {
        const m = { exports: {} };
        process.dlopen(m, wrapperPath);
        if (m.exports && Object.keys(m.exports).length > 0) {
            state.wrapperExports = m.exports;
            log(`POLL captured wrapper exports (${Object.keys(state.wrapperExports).length})`);
            installCtorProxies();
            maybeBootstrap();
        }
    } catch {
        // 未就绪，继续等
    }
}, 500);
// 60s 超时兜底
setTimeout(() => clearInterval(pollInterval), 60000);

// 异步引导（不阻塞 QQ 主进程事件循环）
async function bootstrapAsync() {
    try {
        const { bootstrap } = await import("./boot-bootstrap.js");
        await bootstrap(state);
    } catch (e) {
        log(`bootstrap: 引导失败: ${e?.message ?? e}`);
    }
}

log("boot ready, waiting for wrapper exports...");
