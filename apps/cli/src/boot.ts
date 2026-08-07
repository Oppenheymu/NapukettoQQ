/**
 * cli boot：单账号启动序列（2026-08-07 用户拍板：只保留自建宿主）
 *
 * locate QQ（取版本/wrapper 路径）→ 解析各包 dist 入口 → launchSelfHost
 * （标准 node + stub QQNT.dll 直接 dlopen，不拉起 QQ / 不注入）→ 常驻。
 *
 * 不写业务逻辑：kernel 装配 + 登录 + 协议装配全部在 self-host.cjs → boot-bootstrap.js 完成。
 * 路线 B（拉起 QQ + 注入）已淘汰（launchQqWithLoader 仅历史回退，cli 不再调用）。
 */
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { resolveConfigPath, resolveDataRoot } from "@napuketto/kernel";
import {
    defaultStubDir,
    launchSelfHost,
    type QqInstallInfo,
    resolveQqInstall,
} from "@napuketto/loader";

/** 单账号启动选项。 */
export interface BootOptions {
    /** QQ 号（数据目录账号隔离，ADR-016）。 */
    qq?: string;
    /** 数据根目录（缺省环境变量/用户目录）。 */
    dataDir?: string;
    /** 覆盖 QQ 安装路径（联调）。 */
    qqPath?: string;
    /** stub QQNT.dll 目录（缺省 loader 包内闭源 submodule native/stub-test-env）。 */
    stubDir?: string;
}

/** 解析 workspace 包的 dist 入口（ESM 解析：包是 ESM-only，exports 无 require 条件）。 */
async function packageEntry(pkg: string): Promise<string> {
    const url = await import.meta.resolve(pkg);
    return fileURLToPath(url);
}

/**
 * 原生噪音行（wrapper.node 加载后直写 fd 的 C++ 日志，JS 层无法拦截，只能过滤）：
 *  - `<MMKV` / `<MemoryFile_Win32` / `<MMKV_IO`：MMKV 存储库刷屏（每次初始化打 ~6 行）
 *  - `loadSymbolFromShell` / `getNodeGetJsListApi` / `get symbol failed`：
 *    标准 node 无腾讯私有符号（NodeContextifyContextMetrics 等），GetProcAddress
 *    失败的加载警告（无害，纯噪音）
 */
const NATIVE_NOISE =
    /<MMKV|<MemoryFile_Win32|<MMKV_IO|loadSymbolFromShell|getNodeGetJsListApi|get symbol failed/;

/**
 * 逐行转发子进程输出到父进程，过滤原生噪音。
 * readline 按 UTF-8 解码 pipe 字节流，再经 process.stdout（TTY 路径，
 * WriteConsoleW UTF-16）输出——顺带修复 pino 中文在 cmd.exe/管道 936 转码
 * 链路下的乱码（原生 printf 字节流无法从 JS 侧改编码，转 pipe 后统一解码）。
 */
function forwardFiltered(input: NodeJS.ReadableStream, out: NodeJS.WritableStream): void {
    const lines = createInterface({ input });
    lines.on("line", (line) => {
        if (NATIVE_NOISE.test(line)) {
            return;
        }
        out.write(`${line}\n`);
    });
}

/** 启动单个账号（自建宿主 + 常驻）。 */
export async function runSingleAccount(opts: BootOptions = {}): Promise<void> {
    const dataRoot = resolveDataRoot(opts.dataDir);
    const qq: QqInstallInfo = resolveQqInstall(opts.qqPath);
    const cfgDir = path.join(dataRoot, opts.qq ?? "default");

    const kernelEntry = await packageEntry("@napuketto/kernel");
    const adapterEntry = await packageEntry("@napuketto/adapter");
    const networkEntry = await packageEntry("@napuketto/network");

    const stubDir = opts.stubDir ?? process.env["NAPUTO_STUB_DIR"] ?? defaultStubDir();

    process.stdout.write(
        `[napuketto] QQ: ${qq.version} (${qq.qqPath})\n` +
            `[napuketto] 数据目录: ${cfgDir}\n` +
            `[napuketto] 自建宿主引导（标准 node + stub QQNT.dll）...\n`,
    );

    // 唯一启动路径：自建宿主（2026-08-07 用户拍板，路线 B 淘汰）
    // stdio 接管 stdout/stderr：过滤 MMKV / 符号查找失败等原生噪音，其余转发
    // configPath：全局配置文件（项目根 napuketto.toml），注入 NAPKETTO_CONFIG 供装配链读取
    const { child } = launchSelfHost({
        qq,
        kernelEntry,
        adapterEntry,
        networkEntry,
        cfgDir,
        // 子进程 cwd 指向数据根：QQ 原生层 fallback 落盘（guild1.db 等）
        // 落在专门的数据目录，不污染项目根（实测 08-07）。
        cwd: dataRoot,
        configPath: resolveConfigPath({ dataRoot }),
        selfHost: true,
        stdio: ["inherit", "pipe", "pipe"],
        ...(stubDir !== undefined ? { stubDir } : {}),
    });

    if (child.stdout !== null) {
        forwardFiltered(child.stdout, process.stdout);
    }
    if (child.stderr !== null) {
        forwardFiltered(child.stderr, process.stderr);
    }

    // 常驻：等待自建宿主进程退出
    await new Promise<void>((resolve) => {
        child.on("exit", (code) => {
            process.stdout.write(`[napuketto] 自建宿主进程退出 code=${code}\n`);
            resolve();
        });
        child.on("error", (err) => {
            process.stderr.write(`[napuketto] 启动失败: ${err.message}\n`);
            resolve();
        });
    });
}
