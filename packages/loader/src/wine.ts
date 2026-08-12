/**
 * wine.ts：Linux 上经 wine 运行 Windows 版 node.exe 的路径与 spawn 组装（P2）。
 *
 * 设计文档 §3.2（2026-08-12 拍板确认）。核心认知：
 *  - Windows 版 node.exe 在 wine 内把 Linux 根目录挂载在 `Z:\`
 *  - process.dlopen / 环境变量路径都是 wine 视角的 Windows 路径
 *  - 传给 wine 子进程的**所有路径**（wrapperPath / cfgDir / stubDir / self-host.cjs / PATH）
 *    都要过 toWinePath 转成 `Z:\...`
 *
 * 纯函数设计：不 import node:child_process，方便 Windows 上单测断言（P2 纯逻辑层）。
 */

/** Linux 绝对路径 → wine `Z:\` 路径（Windows 版 node.exe 视角）。幂等：已是 Windows 路径（含盘符）原样返回。 */
export function toWinePath(linuxPath: string): string {
    // 已是 Windows 风格（盘符 + 反斜杠）→ 原样（幂等保护，调用方不应传这种但防御性保留）
    if (DRIVE_LETTER_RE.test(linuxPath)) {
        return linuxPath;
    }
    // /app/.napuketto/qq-files/9.9.33/wrapper.node → Z:\app\.napuketto\qq-files\9.9.33\wrapper.node
    // 去前导 /，正斜杠转反斜杠
    return `Z:\\${linuxPath.replaceAll("/", "\\").replace(LEADING_SLASH_RE, "")}`;
}

/** 前导斜杠（toWinePath 去根用，顶层常量避免每次调用重建）。 */
const LEADING_SLASH_RE = /^\\/;

/** 盘符前缀（C: / Z: 等，识别已转换的 Windows 路径）。 */
const DRIVE_LETTER_RE = /^[A-Za-z]:/;

/** 判断当前是否 Linux（需 wine 的场景）。 */
export function isLinux(): boolean {
    return process.platform === "linux";
}

/** wine 可执行文件（Linux 上 spawn 用；可被 NAPUTO_WINE 覆盖）。 */
export function wineBinary(): string {
    return process.env["NAPUTO_WINE"] ?? "wine";
}

/** spawn 命令与参数（平台分支；纯函数，可单测）。 */
export interface SpawnCommand {
    /** 命令（win32 = node.exe；linux = wine）。 */
    command: string;
    /** 参数（win32 = [selfHostPath]；linux = [winNodePath, selfHostPath]）。 */
    args: string[];
}

/** 组装 spawn 命令（win32 vs linux 分支）。 */
export function buildSpawnCommand(options: {
    /** 平台（缺省 process.platform，测试注入）。 */
    platform?: NodeJS.Platform;
    /** Windows 本机 node 路径（win32 用，缺省 process.execPath）。 */
    winNodePath?: string;
    /** wine 命令（linux 用，缺省 wineBinary()）。 */
    wine?: string;
    /** 自建宿主入口（self-host.cjs，传给 wine/win node）。 */
    selfHostPath: string;
}): SpawnCommand {
    const platform = options.platform ?? process.platform;
    if (platform === "win32") {
        return {
            command: options.winNodePath ?? process.execPath,
            args: [options.selfHostPath],
        };
    }
    // linux 及其他（wine 场景）
    return {
        command: options.wine ?? wineBinary(),
        args: [options.winNodePath ?? "node.exe", options.selfHostPath],
    };
}
