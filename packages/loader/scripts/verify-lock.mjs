// instance-lock 真实链路验证（T1，2026-09-10）：真实 PowerShell 查询 + 真实文件锁。
// 跑法：node packages/loader/scripts/verify-lock.mjs（构建 loader 后）
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
    acquireInstanceLock,
    checkInstanceLock,
    INSTANCE_LOCK_FILE,
    readCmdlineForPid,
} from "../dist/index.mjs";

const dir = mkdtempSync(join(tmpdir(), "napuketto-lock-verify-"));
const dataDir = join(dir, "acct");
mkdirSync(dataDir, { recursive: true });
const lockPath = join(dataDir, INSTANCE_LOCK_FILE);
const results = [];

function lock(pid, cmdline) {
    const payload = { pid, startedAt: Date.now() };
    if (cmdline !== undefined) payload.cmdline = cmdline;
    writeFileSync(lockPath, JSON.stringify(payload), "utf-8");
}

// 场景 0：真实查询当前进程 cmdline（验证 PowerShell 链路本身）
const selfReal = readCmdlineForPid(process.pid);
results.push(["0 真实查询自身 cmdline", typeof selfReal === "string" && selfReal.length > 0, selfReal?.slice(0, 80)]);

// 场景 A：pid 存活 + cmdline 与真实一致 → 占用（真持有者在跑）
const quoted = selfReal ? `"${process.argv[0]}"` : undefined;
lock(process.pid, selfReal ?? "x");
let r = checkInstanceLock(dataDir);
results.push(["A pid存活+cmdline一致 → occupied", r.occupied === true, `occupied=${r.occupied} pid=${r.pid}`]);

// 场景 B：pid 存活 + cmdline 不一致（带引号变体模拟旧持有者）→ 复用接管
lock(process.pid, `${quoted ?? "node"} OLD-DEAD-HOLDER --uin 123`);
r = checkInstanceLock(dataDir);
results.push(["B pid存活+cmdline不一致 → 接管", r.occupied === false, `occupied=${r.occupied}`]);

// 场景 C：pid 不存在 → 残留接管
lock(999999999, "dead");
r = checkInstanceLock(dataDir);
results.push(["C pid不存在 → 接管", r.occupied === false, `occupied=${r.occupied}`]);

// 场景 D：接管后 acquire → 锁重写为新持有者（自动 cmdline 摘要）
const ok = acquireInstanceLock(dataDir);
const newLock = JSON.parse(readFileSync(lockPath, "utf-8"));
results.push([
    "D acquire 重写锁 + 自动 cmdline",
    ok === true && newLock.pid === process.pid && typeof newLock.cmdline === "string" && newLock.cmdline.includes("verify-lock"),
    `pid=${newLock.pid} cmdline=${newLock.cmdline?.slice(0, 60)}...`,
]);

rmSync(dir, { recursive: true, force: true });
let failed = 0;
for (const [name, pass, detail] of results) {
    if (!pass) failed++;
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}  | ${detail}`);
}
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
process.exitCode = failed === 0 ? 0 : 1;
