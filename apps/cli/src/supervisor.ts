/**
 * supervisor：多账号子进程编排（P6，2026-08-05；2026-08-07 自建宿主唯一）
 *
 * 多账号走多进程（ADR-015）：每账号一个独立子进程（node <入口> -q <uin>
 * --data-dir <dataRoot> [--stub-dir <dir>]，复用单账号 runSingleAccount 零改动），
 * 本模块作为父进程：
 *   - 拉起：主配置 accounts（supervisor 子命令）或显式 -q 列表
 *   - 守护：账号异常退出且 autoRestart → 延迟重启
 *   - 信号转发：SIGINT/SIGTERM → 停止全部子进程 → 父进程退出
 */
import { type ChildProcess, spawn } from "node:child_process";
import process from "node:process";
import { resolveDataRoot } from "@napuketto/kernel";
import { loadCliConfig } from "./config-cmds.js";
import type { CliAccountConfig, CliConfig } from "./config-parse.js";
import { logger } from "./logger.js";

/** 默认重启延迟（毫秒）。 */
const DEFAULT_RESTART_DELAY_MS = 2000;
/** 退出轮询间隔（毫秒）。 */
const EXIT_POLL_MS = 100;
/** 子进程强制退出时限（毫秒，超时未退则父进程强制退出）。 */
const FORCE_EXIT_MS = 5000;

/** supervisor 选项。 */
export interface SupervisorOptions {
    /** 数据根目录。 */
    dataDir?: string;
    /** 显式账号列表（-q A -q B），优先于主配置 accounts。 */
    qqs?: string[];
    /** stub QQNT.dll 目录（自建宿主 PATH 前置，透传给子进程 --stub-dir）。 */
    stubDir?: string;
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
    stubDir?: string;
    children: Map<string, ChildProcess>;
    isStopping: () => boolean;
}

/** 启动一个账号子进程（exit 后按 autoRestart 守护重启）。 */
function startAccount(ctx: SupervisorCtx, acct: CliAccountConfig): void {
    if (ctx.isStopping()) {
        return;
    }
    logger.info({ qq: acct.qq }, "启动账号");
    const args = [ctx.entry, "-q", acct.qq, "--data-dir", ctx.dataRoot];
    if (ctx.stubDir !== undefined) {
        args.push("--stub-dir", ctx.stubDir);
    }
    const child = spawn(process.execPath, args, {
        stdio: "inherit",
    });
    ctx.children.set(acct.qq, child);
    child.on("exit", (code, signal) => {
        ctx.children.delete(acct.qq);
        logger.info({ qq: acct.qq, code, signal: signal ?? "none" }, "账号退出");
        if (!ctx.isStopping() && ctx.autoRestart) {
            // 守护：延迟重启（关闭信号到达前无限重试，由 SIGINT/SIGTERM 终止）
            setTimeout(() => {
                startAccount(ctx, acct);
            }, ctx.restartDelayMs);
        }
    });
    child.on("error", (err) => {
        const { message } = err;
        logger.error({ qq: acct.qq, err }, `账号启动失败: ${message}`);
        ctx.children.delete(acct.qq);
    });
}

/** 停止全部子进程，全部退出后父进程退出（2026-08-07：超时强杀兜底）。 */
function stopAll(ctx: SupervisorCtx): void {
    logger.info("收到退出信号，停止全部账号");
    for (const child of ctx.children.values()) {
        child.kill();
    }
    // 超时强杀（2026-08-07 修复）：子进程不响应 SIGTERM（自建宿主卡死等）时
    // 父进程死等 setInterval 永不退出——限时后强制退出。
    const forceTimer = setTimeout(() => {
        logger.warn("子进程未在限时内退出，强制退出");
        process.exit(1);
    }, FORCE_EXIT_MS);
    const wait = setInterval(() => {
        if (ctx.children.size === 0) {
            clearInterval(wait);
            clearTimeout(forceTimer);
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
        logger.warn("supervisor：没有启用的账号（主配置 accounts 为空或全部禁用）");
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
        ...(opts.stubDir !== undefined ? { stubDir: opts.stubDir } : {}),
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
