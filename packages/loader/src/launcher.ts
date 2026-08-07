/**
 * launcher：拉起 QQ.exe + 注入 hook DLL + 引导 boot JS
 *
 * 流程（2026-08-05 事实链）：
 *  1. wrapper.node 只能在 QQ 定制版 Electron 里注册（实测纯 Node/普通 Electron 均 self-register 失败）
 *  2. QQ 是打包应用，禁 NODE_OPTIONS（实测 stderr）
 *  3. QQ.exe 导出 napi_module_register / uv_dlopen（实测 GetProcAddress 可拿）
 *  → 方案：NapukettoBootMain.exe 启动 QQ + 注入 NapukettoWinBootHook.dll，
 *    hook DLL 通过 napi_module_register 注册自研模块，node 调用其 init 拿到 napi_env，
 *    然后执行 boot JS（hook process.dlopen 截获 wrapper.node exports）。
 */
import { type StdioOptions, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { QqInstallInfo } from "./locate-qq.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 解析 native 产物路径（dist/native/）。 */
function nativeDir(): string {
    return join(__dirname, "..", "dist", "native");
}

export interface LaunchOptions {
    /** QQ 安装信息（qqPath/version/wrapperPath）。 */
    qq: QqInstallInfo;
    /** kernel 入口（.mjs，boot.js 里 import）。 */
    kernelEntry: string;
    /** 配置目录。 */
    cfgDir: string;
    /** adapter 入口（.mjs，boot.js 协议装配用）。 */
    adapterEntry?: string;
    /** network 入口（.mjs，boot.js 协议装配用）。 */
    networkEntry?: string;
    /** boot JS 路径（默认 dist/native/runtime/boot.cjs，2026-08-06 拆分后）。 */
    bootJs?: string;
    /** hook DLL 路径（默认 dist/native/NapukettoWinBootHook.dll）。 */
    hookDll?: string;
    /** V2 载具 DLL 路径（默认 dist/native/NapukettoVehicle.dll；仅 routeB=false 时注入）。 */
    vehicleDll?: string;
    /** 无头模式（阻断 UI/GPU，boot.cjs 侧实现，默认 false）。 */
    headless?: boolean;
    /** 路线 B（utilityProcess Worker 模式，2026-08-06；⚠️ 2026-08-07 用户拍板淘汰，显式开启才用）。 */
    routeB?: boolean;
    /** 自建宿主（路线 A，NAPUTO_SELF_HOST，2026-08-07 定稿唯一路线）：标准 node + stub QQNT.dll 直接引导，不拉起 QQ。 */
    selfHost?: boolean;
    /** stub QQNT.dll 目录（自建宿主 PATH 前置，转发 napi_*、uv_* 符号到 node.exe）。 */
    stubDir?: string;
    /** 自建宿主入口（默认 dist/native/runtime/self-host.cjs）。 */
    selfHostEntry?: string;
    /**
     * 子进程 stdio（默认 "inherit"）。cli 传 ["inherit","pipe","pipe"] 并接管
     * 子进程 stdout/stderr：逐行过滤 wrapper 原生噪音（MMKV 刷屏、Node 符号
     * 查找失败警告），其余转发——原生 printf 直写 fd 的字节无法从 JS 层拦截。
     */
    stdio?: StdioOptions;
    /** BootMain.exe 路径（默认 dist/native/NapukettoBootMain.exe，路线 B 历史遗留）。 */
    bootMain?: string;
}

export interface LaunchResult {
    /** 子进程句柄（QQ.exe）。 */
    child: ReturnType<typeof spawn>;
    /** boot JS 路径。 */
    bootJsPath: string;
    /** hook DLL 路径。 */
    hookDllPath: string;
}

/** 启动 QQ 并注入。
 * ⚠️ 2026-08-07 用户拍板：路线 B（拉起 QQ + 注入）淘汰，只保留自建宿主
 *（launchSelfHost）。本函数保留仅作历史回退，cli 默认不再调用。
 */
export function launchQqWithLoader(options: LaunchOptions): LaunchResult {
    const nativeDirPath = nativeDir();
    const bootMainPath = options.bootMain ?? join(nativeDirPath, "NapukettoBootMain.exe");
    const hookDllPath = options.hookDll ?? join(nativeDirPath, "NapukettoWinBootHook.dll");
    const bootJsPath = options.bootJs ?? join(nativeDirPath, "runtime", "boot.cjs");

    for (const [name, p] of [
        ["BootMain.exe", bootMainPath],
        ["HookDll", hookDllPath],
        ["boot.cjs", bootJsPath],
    ] as const) {
        if (!existsSync(p)) {
            throw new Error(`${name} 缺失: ${p}（先运行 pnpm --filter @napuketto/loader build）`);
        }
    }

    const env = buildLaunchEnv(options, bootJsPath, hookDllPath);

    // BootMain 负责 CreateProcess(QQ) + 注入
    const child = spawn(bootMainPath, [], {
        env,
        stdio: "inherit",
        windowsHide: false,
    });

    return { child, bootJsPath, hookDllPath };
}

/**
 * 启动自建宿主（路线 A，2026-08-07 产品化）：spawn 标准 node 直接跑 self-host.cjs，
 * 不拉起 QQ / 不注入。
 *
 * 关键（HANDOVER-V7 技术数据）：wrapper.node 从 QQNT.dll 导入 99 符号
 * （napi_*×40 + uv_*×56 + qq_magic×1 + v8/node mangled×2）——标准 node 无这些宿主
 * 符号，必须 PATH 前置 stub QQNT.dll 目录（转发到 node.exe）+ QQ resources\app
 * （wrapper.node 同目录依赖 DLL）才能 dlopen 成功。
 */
export function launchSelfHost(options: LaunchOptions): LaunchResult {
    const nativeDirPath = nativeDir();
    const selfHostPath = options.selfHostEntry ?? join(nativeDirPath, "runtime", "self-host.cjs");
    if (!existsSync(selfHostPath)) {
        throw new Error(
            `self-host.cjs 缺失: ${selfHostPath}（先运行 pnpm --filter @napuketto/loader build）`,
        );
    }

    // stub QQNT.dll 校验（自建宿主必需：PATH 前置 stub 转发 napi_* 到 node.exe，
    // 否则 wrapper.node dlopen 失败）。默认 loader 包内闭源 native-private/stub-test-env，
    // 缺失时提示 --stub-dir / NAPUTO_STUB_DIR 指定。
    const stub = options.stubDir ?? defaultStubDir();
    if (!existsSync(join(stub, "QQNT.dll"))) {
        throw new Error(
            `stub QQNT.dll 未找到: ${stub}（自建宿主必需：stub 转发 QQNT.dll 符号到 node.exe；` +
                "请用 --stub-dir 或环境变量 NAPUTO_STUB_DIR 指定 stub 目录）",
        );
    }

    const env = buildLaunchEnv(options, selfHostPath, "");
    // PATH 前置 stub 目录（stub QQNT.dll 转发）+ QQ resources\app（wrapper.node 依赖 DLL）
    const pathEntries = [stub, dirname(options.qq.wrapperPath), process.env["PATH"] ?? ""]
        .filter((p) => p !== undefined && p !== "")
        .join(";");
    env["PATH"] = pathEntries;
    env[ENV.STUB_DIR] = stub;

    // 标准 node 直接跑入口（不拉起 QQ，不注入）
    const child = spawn(process.execPath, [selfHostPath], {
        env,
        stdio: options.stdio ?? "inherit",
        windowsHide: false,
    });

    return { child, bootJsPath: selfHostPath, hookDllPath: "" };
}

/**
 * 默认 stub QQNT.dll 目录（loader 包内闭源 native-private/stub-test-env，开发机默认）。
 * src 与 native-private 同层，构建后 dist 与 native-private 同层——`../native-private` 恒正确。
 */
export function defaultStubDir(): string {
    return join(__dirname, "..", "native-private", "stub-test-env");
}

/** 装配注入环境变量（含路线 B / 无头 / vehicle 注入策略）。 */
function buildLaunchEnv(
    options: LaunchOptions,
    bootJsPath: string,
    hookDllPath: string,
): Record<string, string> {
    const nativeDirPath = nativeDir();
    const vehicleDllPath = options.vehicleDll ?? join(nativeDirPath, "NapukettoVehicle.dll");
    const hasVehicle = existsSync(vehicleDllPath);

    // 配置目录兜底
    const cfg = resolve(options.cfgDir);
    mkdirSync(cfg, { recursive: true });

    const env: Record<string, string> = {
        ...process.env,
        [ENV.QQ_PATH]: options.qq.qqPath,
        [ENV.BOOT_JS]: bootJsPath,
        [ENV.HOOK_DLL]: hookDllPath,
        [ENV.KERNEL_ENTRY]: resolve(options.kernelEntry),
        [ENV.CFG_DIR]: cfg,
        [ENV.QQ_VERSION]: options.qq.version,
        [ENV.WRAPPER_PATH]: options.qq.wrapperPath,
    };
    // ⚠️ vehicle（V2 载具，闭源）只在 V1 主进程引导模式注入（routeB: false）：
    //  - 路线 B（worker）继承 QQ env → getNTWrapperSession("nt_1") 天然带 cpp_impl，
    //    不需要 vehicle 激活 session（P2-0 实测确认）。
    //  - vehicle 的 RVA 表针对 9.9.31 逆向（native-private），注入 9.9.33 会内存
    //    patch 到错误地址 → QQ 0xC0000005 崩溃（2026-08-06 实测：boot JS 未执行即崩）。
    //  - 无头由 bootmain 命令行参数（NAPUTO_QQ_ARGS）+ boot-headless.js（JS 侧）实现，
    //    vehicle 的 C++ 阻断职责在路线 B 下不再需要。
    if (hasVehicle && options.routeB === false) {
        env[ENV.VEHICLE_DLL] = vehicleDllPath;
    }
    // 路线 B（默认开启，2026-08-06 定稿）：boot.cjs fork utilityProcess Worker →
    // worker 内 dlopen wrapper.node + kernel 引导（QQ env 原生，P0-B 纯 Node 崩溃点消失）。
    // ⚠️ 2026-08-07 用户拍板：路线 B 淘汰，只保留自建宿主——routeB 改为显式开启
    //（launchQqWithLoader 调用方传 routeB: true 才设置），自建宿主不误设 ROUTE_B。
    if (options.selfHost === true) {
        env[ENV.SELF_HOST] = "1";
    } else if (options.routeB === true) {
        env[ENV.ROUTE_B] = "1";
    }
    if (options.headless === true) {
        env[ENV.HEADLESS] = "1";
        // 无头低内存命令行参数（bootmain CreateProcess 附加，2026-08-06）：
        // appendSwitch 时序太晚（GPU 进程在 app ready 前已 fork），必须命令行传。
        env[ENV.QQ_ARGS] = HEADLESS_QQ_ARGS;
        // 深度无头：压制非关键渲染进程（screenshot/blank），释放其内存。
        // 保留 main/login + hiddenWindow（登录/init IPC 载体）。boot-headless.js 处理。
        env[ENV.DEEP_HEADLESS] = "1";
    }
    if (options.adapterEntry !== undefined) {
        env[ENV.ADAPTER_ENTRY] = resolve(options.adapterEntry);
    }
    if (options.networkEntry !== undefined) {
        env[ENV.NETWORK_ENTRY] = resolve(options.networkEntry);
    }
    return env;
}

/** 环境变量名（hook DLL 与 boot JS 读取）。 */
export const ENV = {
    QQ_PATH: "NAPUTO_QQ_PATH",
    BOOT_JS: "NAPUTO_BOOT_JS",
    HOOK_DLL: "NAPUTO_HOOK_DLL",
    KERNEL_ENTRY: "NAPUTO_KERNEL_ENTRY",
    CFG_DIR: "NAPUTO_CFG_DIR",
    QQ_VERSION: "NAPUTO_QQ_VERSION",
    WRAPPER_PATH: "NAPUTO_WRAPPER_PATH",
    /** V2 载具 DLL 路径（bootmain 注入 NapukettoVehicle.dll）。 */
    VEHICLE_DLL: "NAPUTO_VEHICLE_DLL",
    /** 无头模式开关（boot.cjs 阻断 UI/GPU）。 */
    HEADLESS: "NAPUTO_HEADLESS",
    /** 无头低内存命令行参数（bootmain CreateProcess 附加，如 --disable-gpu）。 */
    QQ_ARGS: "NAPUTO_QQ_ARGS",
    /** 深度无头：压制非关键渲染进程（boot-headless.js，screenshot/blank）。 */
    DEEP_HEADLESS: "NAPUTO_DEEP_HEADLESS",
    /** 路线 B：utilityProcess Worker 模式（boot.cjs 分支）。 */
    ROUTE_B: "NAPUTO_ROUTE_B",
    /** 自建宿主（路线 A）：标准 node + stub QQNT.dll 引导（self-host.cjs 分支）。 */
    SELF_HOST: "NAPUTO_SELF_HOST",
    /** stub QQNT.dll 目录（launchSelfHost 注入，self-host.cjs 诊断用）。 */
    STUB_DIR: "NAPUTO_STUB_DIR",
    /** adapter 包入口（boot.cjs 协议装配用）。 */
    ADAPTER_ENTRY: "NAPUTO_ADAPTER_ENTRY",
    /** network 包入口（boot.cjs 协议装配用）。 */
    NETWORK_ENTRY: "NAPUTO_NETWORK_ENTRY",
} as const;

/**
 * 无头低内存命令行参数组（headless 时注入 NAPUTO_QQ_ARGS）。
 * - disable-gpu / disable-gpu-compositing：GPU 进程不启动（实测 appendSwitch 太晚无效）
 * - disable-software-rasterizer：关软件光栅化（渲染进程省 CPU/内存）
 * - disable-dev-shm-usage：不占 /dev/shm（Windows 下降低共享内存开销）
 * - js-flags=--max-old-space-size=384：限制渲染进程 JS 堆（QQ 渲染 UI 用不到大堆）
 */
export const HEADLESS_QQ_ARGS = [
    "--disable-gpu",
    "--disable-gpu-compositing",
    "--disable-software-rasterizer",
    "--disable-dev-shm-usage",
    "--js-flags=--max-old-space-size=384",
].join(" ");
