/**
 * sync-adapter-deps-core.ts：koishi 适配器依赖同步核心逻辑（纯函数，可单测）。
 *
 * 职责：把 koishi-plugin-adapter 的 package.json 中 @napuketto/kernel、
 * @napuketto/loader 的依赖范围改写为 `~<registry latest>`，让插件发版时
 * 自动追踪主仓库已发布的最新 0.0.x 修复（用户安装/升级插件即拿到最新）。
 *
 * 时序（主仓库 release 链）：changeset version（workspace:* → caret）→
 * 本脚本（caret → ~latest）→ build → publish。changesets 写 caret 会锁死
 * 0.0.x 追踪，本脚本在 version 之后把范围刷成 tilde + 最新版。
 *
 * 纯函数不访问网络/文件系统——副作用由 CLI 层（sync-adapter-deps.ts）执行，
 * 本模块可被 vitest 直接单测。
 */

/** 需要同步的 @napuketto/* 包（key = npm 包名）。 */
export const TRACKED_PACKAGES = ["@napuketto/kernel", "@napuketto/loader"] as const;

/** 单次变更项（planSync 产出）。 */
export interface DepChange {
    /** npm 包名。 */
    pkg: string;
    /** 当前依赖范围（缺省为 "(缺失)"）。 */
    from: string;
    /** 目标 tilde 范围。 */
    to: string;
}

/**
 * 解析版本范围，返回规范化的 tilde 范围（`~<版本>`）。
 * 幂等：已是 `~<最新>` 且版本匹配 → 返回 null（不触发改写）。
 *
 * @param current 当前依赖范围（如 "^0.0.3" / "~0.0.6" / "workspace:~"）
 * @param latest registry latest 版本（如 "0.0.6"）
 * @returns 需写入的 tilde 范围；无需改写则 null
 */
export function tildeRange(current: string | undefined, latest: string): string | null {
    // 归一化比较：去掉 workspace: 前缀与空格
    const norm = (s: string) => s.replace(/^workspace:/, "").trim();
    const cur = current === undefined ? "" : norm(current);
    const target = `~${latest}`;
    return cur === target ? null : target;
}

/**
 * 计算一次同步的变更集（不改写任何文件）。
 *
 * @param deps 插件 package.json 的 dependencies 对象
 * @param latestVersions registry latest 版本映射（包名 → 版本）
 * @returns 变更集；无变更则空数组
 */
export function planSync(
    deps: Record<string, string>,
    latestVersions: Readonly<Record<string, string>>,
): DepChange[] {
    const changes: DepChange[] = [];
    for (const pkg of TRACKED_PACKAGES) {
        const latest = latestVersions[pkg];
        if (latest === undefined) {
            // 查询结果缺包 → 抛错（调用方保证完整性，见 fetchLatestVersions）
            throw new Error(`registry 未返回 ${pkg} 的 latest 版本`);
        }
        const current = deps[pkg];
        const to = tildeRange(current, latest);
        if (to !== null) {
            changes.push({ pkg, from: current ?? "(缺失)", to });
        }
    }
    return changes;
}

/**
 * 从 registry dist-tags 解析 latest 版本。
 *
 * @param distTags npm registry 响应的 "dist-tags" 对象
 * @returns latest 版本字符串
 */
export function latestFromDistTags(distTags: Readonly<Record<string, string>>): string {
    const latest = distTags["latest"];
    if (latest === undefined || latest === "") {
        throw new Error(`registry dist-tags 缺少 latest: ${JSON.stringify(distTags)}`);
    }
    return latest;
}
