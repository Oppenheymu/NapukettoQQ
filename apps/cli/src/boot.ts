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
import { fileURLToPath } from "node:url";
import { resolveDataRoot } from "@napuketto/kernel";
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
    /** stub QQNT.dll 目录（缺省 loader 包内闭源 native-private/stub-test-env）。 */
    stubDir?: string;
}

/** 解析 workspace 包的 dist 入口（ESM 解析：包是 ESM-only，exports 无 require 条件）。 */
async function packageEntry(pkg: string): Promise<string> {
    const url = await import.meta.resolve(pkg);
    return fileURLToPath(url);
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
    const { child } = launchSelfHost({
        qq,
        kernelEntry,
        adapterEntry,
        networkEntry,
        cfgDir,
        selfHost: true,
        ...(stubDir !== undefined ? { stubDir } : {}),
    });

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
