/**
 * ops-commands.ts：status / stop / restart 运维命令实现（2026-09-08 T8）。
 *
 * 数据源：runtime-state 状态文件（supervisor/单账号 boot 写入）+ liveness 检测。
 * stop/restart 语义：
 *  - stop -q <uin>：树杀该账号 boot 进程（连带 self-host）。⚠️ supervisor 在跑
 *    且 autoRestart 时账号会被自动拉起——提示用户先 `napuketto stop`（停 supervisor）。
 *  - stop（无 -q）：树杀 supervisor（子进程随 supervisor 的信号转发退出；若
 *    残留按各账号 runtime pid 逐个树杀兜底）。
 *  - restart：stop 同目标 + detached 重新拉起（-q → 单账号 boot；无 -q →
 *    supervisor autoStart）。
 */
import process from "node:process";
import { logger } from "./logger.js";
import {
    type AccountRuntime,
    aggregateStatus,
    isPidAlive,
    killProcessTree,
    listAccountRuntimes,
    readSupervisorRuntime,
    spawnDetached,
} from "./runtime-state.js";

/** 运维命令选项。 */
export interface OpsOptions {
    dataDir?: string;
    /** 目标账号（stop/restart 指定；status 过滤）。 */
    qq?: string;
}

/** status：聚合输出各账号运行状态（含 supervisor 自身）。 */
export function cmdStatus(dataRoot: string, opts: OpsOptions): void {
    const supervisor = readSupervisorRuntime(dataRoot);
    if (supervisor !== null) {
        logger.info(
            {
                pid: supervisor.pid,
                alive: isPidAlive(supervisor.pid),
                accounts: supervisor.accounts,
                startedAt: supervisor.startedAt,
            },
            "supervisor",
        );
    } else {
        logger.info("supervisor 未运行（无状态文件）");
    }
    const runtimes = listAccountRuntimes(dataRoot).filter(
        (r) => opts.qq === undefined || r.uin === opts.qq,
    );
    if (runtimes.length === 0) {
        logger.warn({ dataRoot }, "没有账号运行时状态（从未启动或数据根不含 runtime.json）");
        return;
    }
    for (const row of aggregateStatus(runtimes)) {
        logger.info(
            {
                uin: row.uin,
                alive: row.alive,
                pid: row.pid,
                kind: row.kind,
                startedAt: row.startedAt,
                restartCount: row.restartCount,
                ...(row.exitCode !== undefined ? { exitCode: row.exitCode } : {}),
            },
            "账号状态",
        );
    }
}

/** 树杀目标账号（按 runtime pid）。 */
function stopAccount(runtime: AccountRuntime): void {
    killProcessTree(runtime.pid);
    logger.info({ uin: runtime.uin, pid: runtime.pid }, "已发送停止（树杀）");
}

/** stop：-q 停单账号；无 -q 停 supervisor + 全部账号兜底。 */
export async function cmdStop(dataRoot: string, opts: OpsOptions): Promise<void> {
    const runtimes = listAccountRuntimes(dataRoot);
    if (opts.qq !== undefined) {
        const target = runtimes.find((r) => r.uin === opts.qq);
        if (target === undefined) {
            logger.error({ uin: opts.qq }, "账号无运行时状态（未启动过）");
            process.exitCode = 1;
            return;
        }
        stopAccount(target);
        const supervisor = readSupervisorRuntime(dataRoot);
        if (supervisor !== null) {
            logger.warn(
                { supervisorPid: supervisor.pid },
                "supervisor 仍在运行且 autoRestart 开启时会自动拉起该账号；如需彻底停止请执行 napuketto stop（停 supervisor）",
            );
        }
        return;
    }
    const supervisor = readSupervisorRuntime(dataRoot);
    if (supervisor !== null) {
        killProcessTree(supervisor.pid);
        logger.info({ pid: supervisor.pid }, "已停止 supervisor（树杀，子进程随信号转发退出）");
    } else {
        logger.warn("supervisor 未运行（无状态文件）");
    }
    // 兜底：残留账号进程逐个树杀（supervisor 信号转发失败的场合）
    for (const runtime of runtimes) {
        stopAccount(runtime);
    }
}

/** restart：stop 同目标 + detached 拉起。 */
export async function cmdRestart(dataRoot: string, opts: OpsOptions): Promise<void> {
    await cmdStop(dataRoot, opts);
    // 等待进程树退出（实例锁：同账号数据目录单实例，立即拉起会抢锁失败）
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const entry = process.argv[1] ?? "";
    const args =
        opts.qq !== undefined
            ? [entry, "-q", opts.qq, "--data-dir", dataRoot]
            : [entry, "--data-dir", dataRoot];
    spawnDetached(args);
    logger.info(
        { args: args.slice(1), qq: opts.qq ?? "(supervisor 全量)" },
        "已 detached 拉起（日志不再接入当前终端，见数据目录 logs/）",
    );
}
