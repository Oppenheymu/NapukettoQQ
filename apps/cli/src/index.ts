#!/usr/bin/env node

/**
 * @napuketto/cli 入口（P2-6 + P6，2026-08-05；2026-08-07 用户拍板：只保留自建宿主）
 *
 * commander 参数解析：
 *   - 单账号：-q <uin> → runSingleAccount（自建宿主：标准 node + stub QQNT.dll，不拉起 QQ）
 *   - 多账号：-q A -q B 或 supervisor 子命令 → runSupervisor（子进程编排）
 *   - config 子命令：init / list / apply（主配置管理）
 *
 * 路线 B（拉起 QQ + 注入）已淘汰（2026-08-07 用户拍板），仅 launchQqWithLoader 历史回退。
 */

import process from "node:process";
import { resolveDataRoot } from "@napuketto/kernel";
import { Command } from "commander";
import { runSingleAccount } from "./boot.js";
import { cmdConfigApply, cmdConfigInit, cmdConfigList, loadCliConfig } from "./config-cmds.js";
import { logger } from "./logger.js";
import { runSupervisor } from "./supervisor.js";

/** commander collect：累积 -q 多值。 */
function collectQq(value: string, prev: string[]): string[] {
    prev.push(value);
    return prev;
}

/** 启动字符画（NapukettoQQ 品牌标识，内嵌；art 含反引号/反斜杠，用数组逐行转义）。 */
const BANNER = [
    "    _   __                  __        __  __        ____  ____ ",
    "   / | / /___ _____  __  __/ /_____  / /_/ /_____  / __ \\/ __ \\",
    "  /  |/ / __ `/ __ \\/ / / / //_/ _ \\/ __/ __/ __ \\/ / / / / / /",
    " / /|  / /_/ / /_/ / /_/ / ,< /  __/ /_/ /_/ /_/ / /_/ / /_/ / ",
    "/_/ |_/\\__,_/ .___/\\__,_/_/|_|\\___/\\__/\\__/\\____/\\___\\_\\___\\_\\ ",
    "           /_/                                                 ",
].join("\n");

/** 统一错误输出（结构化日志，错误对象经 pino serializer 带堆栈）。 */
function reportError(err: unknown): void {
    let message = String(err);
    if (err instanceof Error) {
        const { message: errMessage } = err;
        message = errMessage;
    }
    logger.error({ err }, message);
}

/** 构造可选 dataDir 参数（exactOptionalPropertyTypes 不允许显式 undefined）。 */
function withDataDir(dataDir: string | undefined): { dataDir?: string } {
    if (dataDir === undefined) {
        return {};
    }
    return { dataDir };
}

/** 读主命令已解析的 data-dir（-d 定义在主命令，子命令经此共享）。 */
function rootDataDir(program: Command): { dataDir?: string } {
    return withDataDir(program.opts<{ dataDir?: string }>().dataDir);
}

/** 注册 config 子命令（init/list/apply，P6；-d 复用主命令 option）。 */
function registerConfigCommands(program: Command): void {
    const configCmd = program.command("config").description("全局配置管理（napuketto.toml）");
    configCmd
        .command("init")
        .description("生成默认全局配置")
        .action(async () => {
            try {
                await cmdConfigInit(rootDataDir(program));
            } catch (err) {
                reportError(err);
                process.exitCode = 1;
            }
        });
    configCmd
        .command("list")
        .description("列出全局配置与账号配置")
        .action(async () => {
            try {
                await cmdConfigList(rootDataDir(program));
            } catch (err) {
                reportError(err);
                process.exitCode = 1;
            }
        });
    configCmd
        .command("apply <file>")
        .description("应用外部配置（TOML/JSON，校验后写回全局配置）")
        .action(async (file: string) => {
            try {
                await cmdConfigApply(file, rootDataDir(program));
            } catch (err) {
                reportError(err);
                process.exitCode = 1;
            }
        });
}

/** 注册 supervisor 子命令（读主配置 accounts 批量拉起，P6；-d 复用主命令 option）。 */
function registerSupervisorCommand(program: Command): void {
    program
        .command("supervisor")
        .description("多账号编排（读全局配置 accounts 拉起子进程）")
        .action(async () => {
            try {
                await runSupervisor(rootDataDir(program));
            } catch (err) {
                reportError(err);
                process.exitCode = 1;
            }
        });
}

/** 单账号启动分支（-q 单值；构造 bootOptions 后走 runSingleAccount）。 */
async function runSingleAccountBranch(
    opts: { dataDir?: string; qqPath?: string; stubDir?: string },
    qqs: string[],
): Promise<void> {
    const [only] = qqs;
    if (only === undefined) {
        return;
    }
    const bootOptions: {
        qq?: string;
        dataDir?: string;
        qqPath?: string;
        stubDir?: string;
    } = { qq: only };
    if (opts.dataDir !== undefined) {
        bootOptions.dataDir = opts.dataDir;
    }
    if (opts.qqPath !== undefined) {
        bootOptions.qqPath = opts.qqPath;
    }
    if (opts.stubDir !== undefined) {
        bootOptions.stubDir = opts.stubDir;
    }
    await runSingleAccount(bootOptions);
}

/** 无 -q 时：读全局配置 accounts → 有则 supervisor 拉起；无则单账号启动（自建宿主自动快速登录/QR）。 */
async function autoStart(opts: { dataDir?: string; stubDir?: string }): Promise<void> {
    try {
        const dataRoot = resolveDataRoot(opts.dataDir);
        const config = await loadCliConfig(dataRoot);
        if (config.accounts.length > 0) {
            await runSupervisor({
                ...(opts.dataDir !== undefined ? { dataDir: opts.dataDir } : {}),
                ...(opts.stubDir !== undefined ? { stubDir: opts.stubDir } : {}),
            });
            return;
        }
    } catch {
        // 配置读取失败忽略，直接单账号启动
    }
    const bootOptions: { dataDir?: string; stubDir?: string } = {};
    if (opts.dataDir !== undefined) {
        bootOptions.dataDir = opts.dataDir;
    }
    if (opts.stubDir !== undefined) {
        bootOptions.stubDir = opts.stubDir;
    }
    logger.info("未指定 -q，自动快速登录（无历史账号则二维码登录）");
    await runSingleAccount(bootOptions);
}

/** 注册主命令 action（-q 单账号 / 多 -q supervisor / 无 -q 自动读配置或单账号启动）。 */
function registerMainAction(program: Command): void {
    program.action(
        async (opts: { qq?: string[]; dataDir?: string; qqPath?: string; stubDir?: string }) => {
            const qqs = opts.qq ?? [];
            if (qqs.length === 0) {
                await autoStart(opts);
                return;
            }
            try {
                if (qqs.length === 1) {
                    await runSingleAccountBranch(opts, qqs);
                } else {
                    const supOpts: { dataDir?: string; qqs: string[]; stubDir?: string } = { qqs };
                    if (opts.dataDir !== undefined) {
                        supOpts.dataDir = opts.dataDir;
                    }
                    if (opts.stubDir !== undefined) {
                        supOpts.stubDir = opts.stubDir;
                    }
                    await runSupervisor(supOpts);
                }
            } catch (err) {
                reportError(err);
                process.exitCode = 1;
            }
        },
    );
}

/** 入口：注册全部子命令与主命令后解析。 */
function main(): void {
    // 启动字符画（每次 cli 启动打印）
    process.stdout.write(`${BANNER}\n`);
    const program = new Command();
    program
        .name("napuketto")
        .version("0.0.1")
        .description("NapukettoQQ 机器人框架（OneBot 11 兼容）");

    program
        .option(
            "-q, --qq <uin>",
            "QQ 号（可重复；多个时 supervisor 拉起多账号子进程）",
            collectQq,
            [],
        )
        .option("-d, --data-dir <dir>", "数据根目录（缺省 ~/.napuketto）")
        .option("--qq-path <path>", "QQ 安装路径（联调覆盖）")
        .option(
            "--stub-dir <dir>",
            "stub QQNT.dll 目录（自建宿主 PATH 前置，缺省 loader/native/stub-test-env，Git Submodule）",
        );

    registerConfigCommands(program);
    registerSupervisorCommand(program);
    registerMainAction(program);

    program.parse(process.argv);
}

main();
