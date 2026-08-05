/**
 * @napuketto/cli 入口（P2-6 + P6，2026-08-05）
 *
 * commander 参数解析：
 *   - 单账号：-q <uin> → runSingleAccount（定位 QQ + 拉起注入 + 常驻）
 *   - 多账号：-q A -q B 或 supervisor 子命令 → runSupervisor（子进程编排）
 *   - config 子命令：init / list / apply（主配置管理）
 */

import process from "node:process";
import { Command } from "commander";
import { runSingleAccount } from "./boot.js";
import { cmdConfigApply, cmdConfigInit, cmdConfigList } from "./config-cmds.js";
import { runSupervisor } from "./supervisor.js";

/** commander collect：累积 -q 多值。 */
function collectQq(value: string, prev: string[]): string[] {
    prev.push(value);
    return prev;
}

/** 统一错误输出。 */
function reportError(err: unknown): void {
    let message = String(err);
    if (err instanceof Error) {
        const { message: errMessage } = err;
        message = errMessage;
    }
    process.stderr.write(`[napuketto] ${message}\n`);
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
    const configCmd = program.command("config").description("主配置管理（napuketto.json）");
    configCmd
        .command("init")
        .description("生成默认主配置")
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
        .description("列出主配置与账号配置")
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
        .description("应用外部配置（顶层覆盖合并后写回主配置）")
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
        .description("多账号编排（读主配置 accounts 拉起子进程）")
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
    opts: { dataDir?: string; qqPath?: string },
    qqs: string[],
): Promise<void> {
    const [only] = qqs;
    if (only === undefined) {
        return;
    }
    const bootOptions: { qq?: string; dataDir?: string; qqPath?: string } = { qq: only };
    if (opts.dataDir !== undefined) {
        bootOptions.dataDir = opts.dataDir;
    }
    if (opts.qqPath !== undefined) {
        bootOptions.qqPath = opts.qqPath;
    }
    await runSingleAccount(bootOptions);
}

/** 注册主命令 action（-q 单账号 / 多 -q supervisor）。 */
function registerMainAction(program: Command): void {
    program.action(async (opts: { qq?: string[]; dataDir?: string; qqPath?: string }) => {
        const qqs = opts.qq ?? [];
        if (qqs.length === 0) {
            program.help(); // commander help 终止进程
        }
        try {
            if (qqs.length === 1) {
                await runSingleAccountBranch(opts, qqs);
            } else {
                const supOpts: { dataDir?: string; qqs: string[] } = { qqs };
                if (opts.dataDir !== undefined) {
                    supOpts.dataDir = opts.dataDir;
                }
                await runSupervisor(supOpts);
            }
        } catch (err) {
            reportError(err);
            process.exitCode = 1;
        }
    });
}

/** 入口：注册全部子命令与主命令后解析。 */
function main(): void {
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
        .option("--qq-path <path>", "QQ 安装路径（联调覆盖）");

    registerConfigCommands(program);
    registerSupervisorCommand(program);
    registerMainAction(program);

    program.parse(process.argv);
}

main();
