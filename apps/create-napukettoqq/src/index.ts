#!/usr/bin/env node

/**
 * create-napukettoqq 入口（2026-08-07）。
 *
 * 用法：
 *   create-napukettoqq                # 交互问部署文件夹名（默认 NapukettoQQ）
 *   create-napukettoqq my-bot         # 位置参数指定文件夹名，跳过交互
 *
 * 流程：生成项目骨架（package.json / napuketto.toml / readme.md / .gitignore）
 *   → 用调用方的包管理器（npm_config_user_agent 检测，支持 pnpm/yarn/npm）
 *   自动 install → 询问是否现在启动（默认 Y），Y 则前台运行（Ctrl+C 停止）。
 */

import { spawn } from "node:child_process";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { DEFAULT_PROJECT_NAME, detectPackageManager, pmBin, scaffoldProject } from "./scaffold.js";

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

/** 交互询问是否现在启动（默认 Y）。 */
async function askStartNow(): Promise<boolean> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = (await rl.question("? 是否现在启动？（默认 Y/n）: ")).trim().toLowerCase();
        return answer !== "n" && answer !== "no";
    } finally {
        rl.close();
    }
}

/** 前台执行命令（stdio 继承，用户可见进度/交互），返回退出码。 */
function runInteractive(bin: string, args: string[], cwd: string): Promise<number> {
    return new Promise((resolve) => {
        // Windows 下 .cmd shim 需 shell:true（CreateProcess 不能直接执行 .cmd）
        const child = spawn(bin, args, {
            cwd,
            stdio: "inherit",
            windowsHide: false,
            shell: process.platform === "win32",
        });
        child.on("exit", (code) => {
            resolve(code ?? 0);
        });
    });
}

async function main(): Promise<void> {
    const dirArg = process.argv[2];
    const dirName = dirArg ?? (await askProjectName());
    const result = await scaffoldProject(dirName);
    const pm = detectPackageManager();

    console.log("\n========================================");
    console.log("  NapukettoQQ 项目已生成");
    console.log(`  位置：${result.dir}`);
    console.log(`  包管理器：${pm}（自动检测）`);
    console.log("========================================");
    console.log("前置要求：本机已安装 QQ NT（wrapper.node 来自 QQ 安装目录）。");

    // 自动安装依赖（用调用方包管理器）
    console.log(`\n正在安装依赖（${pm} install）...`);
    const installCode = await runInteractive(pmBin(pm), ["install"], result.dir);
    if (installCode !== 0) {
        console.error(`\n依赖安装失败（退出码 ${installCode}）。请手动执行：`);
        console.error(`  cd ${result.dir}`);
        console.error(`  ${pm} install`);
        process.exitCode = 1;
        return;
    }

    // 询问是否现在启动（默认 Y → 前台运行）
    if (await askStartNow()) {
        console.log(`\n正在启动 NapukettoQQ（Ctrl+C 停止）...\n`);
        const startCode = await runInteractive(pmBin(pm), ["start"], result.dir);
        if (startCode !== 0) {
            process.exitCode = startCode;
        }
    } else {
        console.log("\n启动方式：");
        console.log(`  cd ${result.dir}`);
        console.log(`  ${pm} start -q <你的QQ号>`);
        console.log("详细说明见项目内 readme.md 与 napuketto.toml。");
    }
}

main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`创建失败：${message}`);
    process.exitCode = 1;
});
