#!/usr/bin/env node

/**
 * create-napukettoqq 入口（2026-08-07）。
 *
 * 用法：
 *   create-napukettoqq                # 交互问部署文件夹名（默认 NapukettoQQ）
 *   create-napukettoqq my-bot         # 位置参数指定文件夹名，跳过交互
 *
 * 在当前目录下生成 NapukettoQQ 机器人项目骨架（package.json / napuketto.toml /
 * readme.md / .gitignore），随后打印下一步指引（pnpm install && pnpm start）。
 */

import process from "node:process";
import { createInterface } from "node:readline/promises";
import { DEFAULT_PROJECT_NAME, scaffoldProject } from "./scaffold.js";

/** 交互询问部署文件夹名（回车取默认值）。 */
async function askProjectName(): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = await rl.question(`? 部署文件夹名（默认 ${DEFAULT_PROJECT_NAME}）: `);
        return answer.trim() || DEFAULT_PROJECT_NAME;
    } finally {
        rl.close();
    }
}

/** 打印生成结果与下一步指引（功能输出，不经日志框架）。 */
function printNextSteps(dir: string): void {
    console.log("\n========================================");
    console.log("  NapukettoQQ 项目已生成");
    console.log(`  位置：${dir}`);
    console.log("========================================");
    console.log("下一步：");
    console.log(`  cd ${dir}`);
    console.log("  pnpm install");
    console.log("  pnpm start -q <你的QQ号>");
    console.log("");
    console.log("前置要求：本机已安装 QQ NT（wrapper.node 来自 QQ 安装目录）。");
    console.log("详细说明见项目内 readme.md 与 napuketto.toml。");
}

async function main(): Promise<void> {
    const dirArg = process.argv[2];
    const dirName = dirArg ?? (await askProjectName());
    const result = await scaffoldProject(dirName);
    printNextSteps(result.dir);
}

main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`创建失败：${message}`);
    process.exitCode = 1;
});
