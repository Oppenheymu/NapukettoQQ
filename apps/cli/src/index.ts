/**
 * @napuketto/cli 入口（P2-6，2026-08-05）
 *
 * commander 参数解析 → runSingleAccount（定位 QQ + 拉起注入 + 常驻）。
 * 后续：config 子命令、supervisor 多账号编排（P6）。
 */

import process from "node:process";
import { Command } from "commander";
import { runSingleAccount } from "./boot.js";

/** 解析参数并启动。 */
async function main(): Promise<void> {
    const program = new Command();
    program
        .name("napuketto")
        .version("0.0.1")
        .description("NapukettoQQ 机器人框架（OneBot 11 兼容）");

    program
        .option("-q, --qq <uin>", "QQ 号（数据目录按账号隔离）")
        .option("-d, --data-dir <dir>", "数据根目录（缺省 ~/.napuketto）")
        .option("--qq-path <path>", "QQ 安装路径（联调覆盖）");

    program.parse(process.argv);
    const opts = program.opts<{ qq?: string; dataDir?: string; qqPath?: string }>();

    try {
        const bootOptions: { qq?: string; dataDir?: string; qqPath?: string } = {};
        if (opts.qq !== undefined) {
            bootOptions.qq = opts.qq;
        }
        if (opts.dataDir !== undefined) {
            bootOptions.dataDir = opts.dataDir;
        }
        if (opts.qqPath !== undefined) {
            bootOptions.qqPath = opts.qqPath;
        }
        await runSingleAccount(bootOptions);
    } catch (err) {
        let message = String(err);
        if (err instanceof Error) {
            // biome-ignore lint/style/useDestructuring: err 为 unknown 运行时窄化
            message = err.message;
        }
        process.stderr.write(`[napuketto] 启动失败: ${message}\n`);
        process.exitCode = 1;
    }
}

await main();
