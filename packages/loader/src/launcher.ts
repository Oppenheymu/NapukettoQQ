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
import { spawn } from "node:child_process";
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
    /** V2 载具 DLL 路径（默认 dist/native/NapukettoVehicle.dll，存在则注入）。 */
    vehicleDll?: string;
    /** 无头模式（阻断 UI/GPU，boot.cjs 侧实现，默认 false）。 */
    headless?: boolean;
    /** 路线 B（utilityProcess Worker 模式，2026-08-06 定稿默认开启）。 */
    routeB?: boolean;
    /** BootMain.exe 路径（默认 dist/native/NapukettoBootMain.exe）。 */
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

/** 启动 QQ 并注入。 */
export function launchQqWithLoader(options: LaunchOptions): LaunchResult {
    const nativeDirPath = nativeDir();
    const bootMainPath = options.bootMain ?? join(nativeDirPath, "NapukettoBootMain.exe");
    const hookDllPath = options.hookDll ?? join(nativeDirPath, "NapukettoWinBootHook.dll");
    const bootJsPath = options.bootJs ?? join(nativeDirPath, "runtime", "boot.cjs");
    // V2 载具 DLL：存在则注入（激活 session cpp_impl + 无头）
    const vehicleDllPath = options.vehicleDll ?? join(nativeDirPath, "NapukettoVehicle.dll");
    const hasVehicle = existsSync(vehicleDllPath);

    for (const [name, p] of [
        ["BootMain.exe", bootMainPath],
        ["HookDll", hookDllPath],
        ["boot.cjs", bootJsPath],
    ] as const) {
        if (!existsSync(p)) {
            throw new Error(`${name} 缺失: ${p}（先运行 pnpm --filter @napuketto/loader build）`);
        }
    }

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
    if (hasVehicle) {
        env[ENV.VEHICLE_DLL] = vehicleDllPath;
    }
    // 路线 B（默认开启，2026-08-06 定稿）：boot.cjs fork utilityProcess Worker →
    // worker 内 dlopen wrapper.node + kernel 引导（QQ env 原生，P0-B 纯 Node 崩溃点消失）。
    if (options.routeB !== false) {
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

    // BootMain 负责 CreateProcess(QQ) + 注入
    const child = spawn(bootMainPath, [], {
        env,
        stdio: "inherit",
        windowsHide: false,
    });

    return { child, bootJsPath, hookDllPath };
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
