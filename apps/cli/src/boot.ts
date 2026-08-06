/**
 * cli boot：单账号启动序列（P2-6）
 *
 * locate QQ → 解析各包 dist 入口 → launchQqWithLoader（BootMain 拉起 QQ + 注入）
 * → 常驻等待 QQ 退出（信号转发由父进程/系统处理）。
 *
 * 不写业务逻辑：kernel 装配 + 登录 + 协议装配全部在 QQ 主进程内的 boot.cjs 完成。
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveDataRoot } from "@napuketto/kernel";
import { launchQqWithLoader, type QqInstallInfo, resolveQqInstall } from "@napuketto/loader";

/** 单账号启动选项。 */
export interface BootOptions {
    /** QQ 号（数据目录账号隔离，ADR-016）。 */
    qq?: string;
    /** 数据根目录（缺省环境变量/用户目录）。 */
    dataDir?: string;
    /** 覆盖 QQ 安装路径（联调）。 */
    qqPath?: string;
}

/** 解析 workspace 包的 dist 入口（ESM 解析：包是 ESM-only，exports 无 require 条件）。 */
async function packageEntry(pkg: string): Promise<string> {
    const url = await import.meta.resolve(pkg);
    return fileURLToPath(url);
}

/** 启动单个 QQ 账号（注入 + 常驻）。 */
export async function runSingleAccount(opts: BootOptions = {}): Promise<void> {
    const dataRoot = resolveDataRoot(opts.dataDir);
    const qq: QqInstallInfo = resolveQqInstall(opts.qqPath);
    const cfgDir = path.join(dataRoot, opts.qq ?? "default");

    const kernelEntry = await packageEntry("@napuketto/kernel");
    const adapterEntry = await packageEntry("@napuketto/adapter");
    const networkEntry = await packageEntry("@napuketto/network");

    process.stdout.write(
        `[napuketto] QQ: ${qq.version} (${qq.qqPath})\n` +
            `[napuketto] 数据目录: ${cfgDir}\n` +
            "[napuketto] 拉起 QQ 并注入 hook...\n",
    );

    const { child } = launchQqWithLoader({
        qq,
        kernelEntry,
        adapterEntry,
        networkEntry,
        cfgDir,
        // 默认无头（V2）：载具激活 cpp_impl 后主进程不再依赖渲染进程 UI，
        // 登录走主进程 NAPI 快速登录 / QR（二维码写文件）。QQ 界面不再弹出。
        headless: true,
    });

    // 常驻：等待 QQ 进程退出
    await new Promise<void>((resolve) => {
        child.on("exit", (code) => {
            process.stdout.write(`[napuketto] QQ 进程退出 code=${code}\n`);
            resolve();
        });
        child.on("error", (err) => {
            process.stderr.write(`[napuketto] 启动 QQ 失败: ${err.message}\n`);
            resolve();
        });
    });
}
