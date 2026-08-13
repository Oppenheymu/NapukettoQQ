#!/usr/bin/env node
/**
 * release-npm.ts：npm 逐个发布 CLI（发布链最后一环）。
 *
 * 用法（Node 22.7+ 原生 type stripping，零构建直接跑）：
 *   node scripts/release-npm.ts            # 拓扑序逐个 npm publish --access public
 *   node scripts/release-npm.ts --dry-run  # 只跑 npm publish --dry-run（打包检查，不发布）
 *
 * 前置（由根 package.json 的 release 链保证）：
 *   1. pnpm changeset version —— workspace:* 已改写为真实版本号（caret），
 *      npm 不认 workspace:* 协议，缺失会直接发布失败
 *   2. node scripts/sync-adapter-deps.ts —— koishi 适配器的 kernel/loader
 *      依赖已刷成 ~latest
 *   3. pnpm -r build —— 各包 dist 已构建
 *
 * 行为：
 *   - 发布前查询 registry：本地版本已存在（changeset 未 bump 的包）→ 跳过
 *   - 仅对需要发布的包做拓扑排序（被依赖者在前）并逐个 npm publish
 *   - 任一包失败 → 立即中断，退出码非 0（避免后续包依赖残缺上游）
 *   - npm 7+ git-checks：发布前工作区必须已提交（dirty 会被拒绝）
 *
 * 纯逻辑在 ./release-npm-core.ts（可单测），本文件只做参数解析 + 进程执行。
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverPackages, planPublish, topoSort } from "./release-npm-core.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const REGISTRY = process.env["NAPKETTO_REGISTRY"] ?? "https://registry.npmjs.org";

/** 命令行参数解析结果。 */
export interface ReleaseArgs {
    /** 只打包不发布（npm publish --dry-run）。 */
    dryRun: boolean;
}

/** 解析命令行参数（--dry-run）。 */
export function parseArgs(argv: readonly string[]): ReleaseArgs {
    return { dryRun: argv.includes("--dry-run") };
}

/**
 * 查询单个 npm 包在 registry 的所有已发布版本。
 * 404（包从未发布）→ 空集；其他非 200 → 抛错（发布链中断）。
 */
export async function fetchPublishedVersions(pkgName: string): Promise<Set<string>> {
    const url = `${REGISTRY}/${pkgName.replace("/", "%2F")}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.status === 404) {
        return new Set();
    }
    if (!res.ok) {
        throw new Error(`registry 查询失败 ${pkgName}: HTTP ${res.status}`);
    }
    const json = (await res.json()) as { versions?: Record<string, unknown> };
    return new Set(Object.keys(json["versions"] ?? {}));
}

/** 在包目录执行 npm publish，返回退出码。 */
export function publishPkg(pkg: { name: string; dir: string }, dryRun: boolean): number {
    const args = ["publish", "--access", "public", ...(dryRun ? ["--dry-run"] : [])];
    // Windows 上 npm 是 npm.cmd 批处理，CreateProcess 无法直接执行 .cmd（spawn
    // 报 ENOENT）——必须经 cmd.exe（ComSpec）显式执行。参数数组原样传递，不经
    // shell 展开，无注入面（规避 Node 对 shell:true 传参的 DEP0190 警告）。
    const isWin = process.platform === "win32";
    const cmd = isWin ? (process.env["ComSpec"] ?? "cmd.exe") : "npm";
    const cmdArgs = isWin ? ["/d", "/s", "/c", "npm", ...args] : args;
    const res = spawnSync(cmd, cmdArgs, {
        cwd: pkg.dir,
        stdio: "inherit",
    });
    if (res.error !== undefined) {
        // 进程启动失败（npm 不在 PATH 等）——不能只看 status，否则静默吞错
        process.stderr.write(`[release-npm] ⚠️ 无法启动 npm: ${res.error.message}\n`);
        return 1;
    }
    return res.status ?? 1;
}

/** 主流程：发现 → 查 registry 版本 → 过滤已发布 → 拓扑排序 → 逐个发布。 */
export async function main(argv: readonly string[]): Promise<number> {
    const { dryRun } = parseArgs(argv);
    const pkgs = await discoverPackages(REPO_ROOT);
    if (pkgs.length === 0) {
        console.log("[release-npm] 未发现任何可发布包");
        return 0;
    }

    // 发布前查询 registry，只发布版本有变化的包（changeset 未 bump 的跳过）
    const published = new Map<string, Set<string>>();
    await Promise.all(
        pkgs.map(async (pkg) => {
            published.set(pkg.name, await fetchPublishedVersions(pkg.name));
        }),
    );
    const { toPublish, skipped } = planPublish(pkgs, published);

    if (skipped.length > 0) {
        console.log(`[release-npm] 跳过（版本已在 registry，${skipped.length} 个）:`);
        for (const item of skipped) {
            console.log(`  ⏭  ${item.pkg.name}@${item.pkg.version}（${item.reason}）`);
        }
    }
    if (toPublish.length === 0) {
        console.log("[release-npm] 无需发布，全部版本已在 registry");
        return 0;
    }

    const ordered = topoSort(toPublish);
    console.log(
        `[release-npm] 发布顺序（${ordered.length} 个包，${dryRun ? "dry-run" : "publish"}）:`,
    );
    for (const pkg of ordered) {
        console.log(`  ${pkg.name}@${pkg.version}`);
    }
    for (const pkg of ordered) {
        const code = publishPkg(pkg, dryRun);
        if (code !== 0) {
            console.log(
                `[release-npm] ❌ 发布失败: ${pkg.name}@${pkg.version}（退出码 ${code}），已中断`,
            );
            return code;
        }
        console.log(`[release-npm] ✅ 已发布: ${pkg.name}@${pkg.version}`);
    }
    console.log(`[release-npm] 全部完成（${dryRun ? "dry-run" : "已发布"}）`);
    return 0;
}

// 直接执行（非被 import 测试）时运行
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2))
        .then((code) => {
            process.exitCode = code;
        })
        .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[release-npm] ❌ ${message}\n`);
            process.exitCode = 1;
        });
}
