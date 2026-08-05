/**
 * supervisor：多账号子进程编排（P6，2026-08-05）
 *
 * 多账号走多进程（ADR-015）：每账号一个独立子进程（node <入口> -q <uin>
 * --data-dir <dataRoot>，复用单账号 runSingleAccount 零改动），本模块作为父进程：
 *   - 拉起：主配置 accounts（supervisor 子命令）或显式 -q 列表
 *   - 守护：账号异常退出且 autoRestart → 延迟重启
 *   - 信号转发：SIGINT/SIGTERM → 停止全部子进程 → 父进程退出
 */
import { type ChildProcess, spawn } from "node:child_process";
import process from "node:process";
import { resolveDataRoot } from "@napuketto/kernel";
import type { CliAccountConfig, CliConfig } from "./config-cmds.js";
import { loadCliConfig } from "./config-cmds.js";

/** 默认重启延迟（毫秒）。 */
const DEFAULT_RESTART_DELAY_MS = 2000;
/** 退出轮询间隔（毫秒）。 */
const EXIT_POLL_MS = 100;

/** supervisor 选项。 */
export interface SupervisorOptions {
    /** 数据根目录。 */
    dataDir?: string;
    /** 显式账号列表（-q A -q B），优先于主配置 accounts。 */
    qqs?: string[];
}

/** 解析账号列表（显式 -q 优先，否则主配置 accounts 过滤启用项）。 */
function resolveAccounts(opts: SupervisorOptions, config: CliConfig): CliAccountConfig[] {
    if (opts.qqs !== undefined && opts.qqs.length > 0) {
        return opts.qqs.map((qq) => ({ qq }));
    }
    return config.accounts.filter((acct) => acct.enabled !== false);
}

/** 解析重启延迟（显式 -q 用默认，主配置场景用配置值）。 */
function resolveRestartDelay(opts: SupervisorOptions, config: CliConfig): number {
    if (opts.qqs === undefined) {
        return config.restartDelayMs;
    }
    return DEFAULT_RESTART_DELAY_MS;
}

/** 监督上下文（startAccount / stopAll 共享，避免闭包过长）。 */
interface SupervisorCtx {
    dataRoot: string;
    entry: string;
    restartDelayMs: number;
    autoRestart: boolean;
    children: Map<string, ChildProcess>;
    isStopping: () => boolean;
}

/** 启动一个账号子进程（exit 后按 autoRestart 守护重启）。 */
function startAccount(ctx: SupervisorCtx, acct: CliAccountConfig): void {
    if (ctx.isStopping()) {
        return;
    }
    process.stdout.write(`[napuketto] 启动账号 ${acct.qq}...\n`);
    const child = spawn(process.execPath, [ctx.entry, "-q", acct.qq, "--data-dir", ctx.dataRoot], {
        stdio: "inherit",
    });
    ctx.children.set(acct.qq, child);
    child.on("exit", (code, signal) => {
        ctx.children.delete(acct.qq);
        process.stdout.write(
            `[napuketto] 账号 ${acct.qq} 退出 code=${code} signal=${signal ?? "none"}\n`,
        );
        if (!ctx.isStopping() && ctx.autoRestart) {
            // 守护：延迟重启（关闭信号到达前无限重试，由 SIGINT/SIGTERM 终止）
            setTimeout(() => {
                startAccount(ctx, acct);
            }, ctx.restartDelayMs);
        }
    });
    child.on("error", (err) => {
        const { message } = err;
        process.stderr.write(`[napuketto] 账号 ${acct.qq} 启动失败: ${message}\n`);
        ctx.children.delete(acct.qq);
    });
}

/** 停止全部子进程，全部退出后父进程退出。 */
function stopAll(ctx: SupervisorCtx): void {
    process.stdout.write("[napuketto] 收到退出信号，停止全部账号...\n");
    for (const child of ctx.children.values()) {
        child.kill();
    }
    const wait = setInterval(() => {
        if (ctx.children.size === 0) {
            clearInterval(wait);
            process.exit(0);
        }
    }, EXIT_POLL_MS);
}

/** 运行 supervisor（多账号编排）。 */
export async function runSupervisor(opts: SupervisorOptions = {}): Promise<void> {
    const dataRoot = resolveDataRoot(opts.dataDir);
    const config = await loadCliConfig(dataRoot);
    const accounts = resolveAccounts(opts, config);
    if (accounts.length === 0) {
        process.stdout.write(
            "[napuketto] supervisor：没有启用的账号（主配置 accounts 为空或全部禁用）\n",
        );
        return;
    }
    const restartDelayMs = resolveRestartDelay(opts, config);
    const [, entry = ""] = process.argv;
    const children = new Map<string, ChildProcess>();
    let stopping = false;
    const ctx: SupervisorCtx = {
        dataRoot,
        entry,
        restartDelayMs,
        autoRestart: config.autoRestart,
        children,
        isStopping: () => stopping,
    };

    for (const acct of accounts) {
        startAccount(ctx, acct);
    }

    // 信号转发：停止全部子进程 → 父进程退出
    const shutdown = (): void => {
        if (stopping) {
            return;
        }
        stopping = true;
        stopAll(ctx);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // 常驻：直到收到退出信号（stopAll 内 process.exit）
    await new Promise<void>(() => {
        // 永不 resolve，由 stopAll 的 process.exit 结束进程
    });
}
