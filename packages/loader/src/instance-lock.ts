/**
 * instance-lock.ts：单实例锁（2026-08-07 根治「多实例抢数据目录锁挂起」）
 *
 * 背景（实测）：同一账号数据目录（~/.napuketto/<uin>）只能被一个实例持有——
 * QQ 原生层（MMKV / 登录单例 / 数据库）有锁，第二个实例抢不到锁会卡在
 * loginService.initConfig 之后无响应（挂起）。此前 create-napukettoqq 生成的
 * 副本实例常驻占锁，导致用户后续启动全部卡死。
 *
 * 方案：以数据目录为粒度加锁文件 `<dataDir>/instance.lock`（JSON 内容：
 * pid / startedAt / cmdline 摘要）。启动前 checkInstanceLock：
 *   - 锁不存在 → 可启动（然后 acquireInstanceLock 写入）
 *   - 锁存在但 PID 已死 → 崩溃残留，自动清理（rm + 重新获取）
 *   - 锁存在且 PID 存活 → 已被占用，拒绝启动（返回占用 PID 供提示）
 *
 * 退出清理：进程正常退出时 releaseInstanceLock 删除锁文件；崩溃/强杀残留
 * 由下次启动的「PID 存活检测」兜底（PID 已死 → 残留视为过期）。
 *
 * 放置说明：放 loader 而非 kernel——self-host.cjs 是 rolldown 内联 bundle
 * （只内联 src/host/ 依赖树），静态 import kernel 会留 external 缺口；
 * 放 loader 则 self-host（内联）与 cli（@napuketto/loader 导入）双入口可用。
 */

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

/** 锁文件名（置于数据目录内）。 */
export const INSTANCE_LOCK_FILE = "instance.lock";

/** 锁文件内容。 */
export interface InstanceLockInfo {
    /** 持有实例的进程 PID。 */
    pid: number;
    /** 获取锁的时间（epoch ms）。 */
    startedAt: number;
    /** 命令行摘要（诊断用，可选）。 */
    cmdline?: string;
}

/** 数据目录锁检查结果。 */
export interface InstanceLockCheck {
    /** 是否被其他实例占用。 */
    occupied: boolean;
    /** 占用进程 PID（occupied=true 时有效）。 */
    pid: number | null;
    /** 锁文件完整路径（提示/清理用）。 */
    lockPath: string;
}

/**
 * 检测指定数据目录是否已被其他实例占用。
 *
 * @param dataDir 数据目录（账号级，如 ~/.napuketto/3567141148）
 */
export function checkInstanceLock(dataDir: string): InstanceLockCheck {
    const lockPath = join(dataDir, INSTANCE_LOCK_FILE);
    let info: InstanceLockInfo | null = null;
    try {
        info = JSON.parse(readFileSync(lockPath, "utf-8")) as InstanceLockInfo;
    } catch {
        // 文件不存在 / 内容损坏 → 视为可启动（损坏锁由 acquire 覆盖）
        return { occupied: false, pid: null, lockPath };
    }
    if (typeof info.pid !== "number" || Number.isNaN(info.pid) || info.pid <= 0) {
        return { occupied: false, pid: null, lockPath };
    }
    // PID 存活判定（Windows 下 process.kill(pid, 0) 探测）
    let alive = false;
    try {
        process.kill(info.pid, 0);
        alive = true;
    } catch {
        alive = false;
    }
    if (!alive) {
        // 崩溃残留：持有者已死，可安全接管
        return { occupied: false, pid: null, lockPath };
    }
    return { occupied: true, pid: info.pid, lockPath };
}

/**
 * 获取数据目录锁。占用（其他实例存活）返回 false；成功或清理残留后返回 true。
 * 幂等：本进程已持有则直接返回 true（不重复写）。
 */
export function acquireInstanceLock(dataDir: string, cmdline?: string): boolean {
    const { occupied, pid, lockPath } = checkInstanceLock(dataDir);
    if (occupied) {
        // 已占用：除非占用者是自己（PID 复用保护），否则拒绝
        if (pid === process.pid) {
            return true;
        }
        return false;
    }
    // 残留锁（持有者已死 / 无锁）：写入
    const info: InstanceLockInfo = {
        pid: process.pid,
        startedAt: Date.now(),
        ...(cmdline !== undefined && cmdline !== "" ? { cmdline } : {}),
    };
    try {
        rmSync(lockPath, { force: true });
        writeFileSync(lockPath, JSON.stringify(info), "utf-8");
        return true;
    } catch {
        return false;
    }
}

/**
 * 释放数据目录锁（正常退出时调用）。仅当持有者是本进程时才删除，
 * 避免误删新持有者的锁（PID 复用 / 快速重启场景）。
 */
export function releaseInstanceLock(dataDir: string): void {
    const lockPath = join(dataDir, INSTANCE_LOCK_FILE);
    try {
        const info = JSON.parse(readFileSync(lockPath, "utf-8")) as InstanceLockInfo;
        if (info.pid === process.pid) {
            rmSync(lockPath, { force: true });
        }
    } catch {
        // 文件不存在 / 内容损坏 → 无需清理
    }
}

/** 注册进程退出清理（SIGINT/SIGTERM/exit 均触发；崩溃强杀由残留检测兜底）。 */
export function registerLockCleanup(dataDir: string): void {
    process.on("exit", () => {
        releaseInstanceLock(dataDir);
    });
}
