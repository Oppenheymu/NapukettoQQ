/**
 * launcher：自建宿主引导（2026-08-07 唯一路线）——spawn 标准 node 跑 self-host.cjs。
 *
 * 历史（V1/路线 B 事实链，已归档 archive/）：
 *  1. wrapper.node 只能在 QQ 定制版 Electron 里注册（实测纯 Node/普通 Electron 均 self-register 失败）
 *  2. QQ 是打包应用，禁 NODE_OPTIONS（实测 stderr）
 *  → 旧方案：NapukettoBootMain.exe 启动 QQ + 注入 NapukettoWinBootHook.dll（已废弃）
 *  → 现方案：stub QQNT.dll 转发宿主符号 → 标准 node 直接 dlopen wrapper.node（自建宿主）
 */
import { type StdioOptions, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { QqInstallInfo } from "./locate-qq.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface LaunchOptions {
    /** QQ 安装信息（qqPath/version/wrapperPath）。 */
    qq: QqInstallInfo;
    /** kernel 入口（.mjs，self-host.cjs 里 import）。 */
    kernelEntry: string;
    /** 配置目录（账号数据目录，NAPUTO_CFG_DIR）。 */
    cfgDir: string;
    /** 全局配置文件路径（项目根 napuketto.toml，注入 NAPKETTO_CONFIG 供装配链读取）。 */
    configPath?: string;
    /** adapter 入口（.mjs，协议装配用）。 */
    adapterEntry?: string;
    /** network 入口（.mjs，协议装配用）。 */
    networkEntry?: string;
    /** 自建宿主：标准 node + stub QQNT.dll 直接引导，不拉起 QQ（2026-08-07 唯一路线）。 */
    selfHost?: boolean;
    /** stub QQNT.dll 目录（PATH 前置，转发 napi_*、uv_* 符号到 node.exe）。 */
    stubDir?: string;
    /** 自建宿主入口（默认 dist/host/self-host.cjs）。 */
    selfHostEntry?: string;
    /**
     * 子进程 stdio（默认 "inherit"）。cli 传 ["inherit","pipe","pipe"] 并接管
     * 子进程 stdout/stderr：逐行过滤 wrapper 原生噪音（MMKV 刷屏、Node 符号
     * 查找失败警告），其余转发——原生 printf 直写 fd 的字节无法从 JS 层拦截。
     */
    stdio?: StdioOptions;
}

export interface LaunchResult {
    /** 子进程句柄（自建宿主 node 进程）。 */
    child: ReturnType<typeof spawn>;
    /** 自建宿主入口路径（self-host.cjs）。 */
    bootJsPath: string;
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
    const selfHostPath =
        options.selfHostEntry ?? join(__dirname, "..", "dist", "host", "self-host.cjs");
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

    const env = buildLaunchEnv(options);
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

    return { child, bootJsPath: selfHostPath };
}

/**
 * 默认 stub QQNT.dll 目录（loader 包内闭源 native-private/build/stub-test-env，开发机默认）。
 * src 与 native-private 同层，构建后 dist 与 native-private 同层——`../native-private` 恒正确。
 */
export function defaultStubDir(): string {
    return join(__dirname, "..", "native-private", "build", "stub-test-env");
}

/** 装配自建宿主环境变量。 */
function buildLaunchEnv(options: LaunchOptions): Record<string, string> {
    // 配置目录兜底
    const cfg = resolve(options.cfgDir);
    mkdirSync(cfg, { recursive: true });

    const env: Record<string, string> = {
        ...process.env,
        [ENV.QQ_PATH]: options.qq.qqPath,
        [ENV.KERNEL_ENTRY]: resolve(options.kernelEntry),
        [ENV.CFG_DIR]: cfg,
        [ENV.QQ_VERSION]: options.qq.version,
        [ENV.WRAPPER_PATH]: options.qq.wrapperPath,
    };
    if (options.selfHost === true) {
        env[ENV.SELF_HOST] = "1";
    }
    if (options.adapterEntry !== undefined) {
        env[ENV.ADAPTER_ENTRY] = resolve(options.adapterEntry);
    }
    if (options.networkEntry !== undefined) {
        env[ENV.NETWORK_ENTRY] = resolve(options.networkEntry);
    }
    if (options.configPath !== undefined) {
        env[ENV.CONFIG_PATH] = resolve(options.configPath);
    }
    return env;
}

/** 环境变量名（self-host.cjs 与 kernel 引导读取）。 */
export const ENV = {
    QQ_PATH: "NAPUTO_QQ_PATH",
    KERNEL_ENTRY: "NAPUTO_KERNEL_ENTRY",
    CFG_DIR: "NAPUTO_CFG_DIR",
    QQ_VERSION: "NAPUTO_QQ_VERSION",
    WRAPPER_PATH: "NAPUTO_WRAPPER_PATH",
    /** 自建宿主：标准 node + stub QQNT.dll 引导（self-host.cjs 分支）。 */
    SELF_HOST: "NAPUTO_SELF_HOST",
    /** stub QQNT.dll 目录（launchSelfHost 注入，self-host.cjs 诊断用）。 */
    STUB_DIR: "NAPUTO_STUB_DIR",
    /** adapter 包入口（协议装配用）。 */
    ADAPTER_ENTRY: "NAPUTO_ADAPTER_ENTRY",
    /** network 包入口（协议装配用）。 */
    NETWORK_ENTRY: "NAPUTO_NETWORK_ENTRY",
    /** 全局配置文件路径（项目根 napuketto.toml，boot-protocols 读取）。 */
    CONFIG_PATH: "NAPKETTO_CONFIG",
} as const;
