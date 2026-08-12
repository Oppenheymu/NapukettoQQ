/**
 * 定位 QQ 原生文件（wrapper.node）来源（P0：多级来源纯定位，不下载）。
 *
 * 来源优先级（resolveQqFiles）：
 *   L0: NAPUTO_QQ_FILES / qqFilesDir —— 显式指定含 versions/ 结构的文件根（缓存/拷贝）
 *   L1: 本机 QQ 安装 —— NAPUTO_QQ_PATH / 注册表 / 常见路径（既有逻辑保留）
 *   L2: 数据根缓存 <数据根>/qq-files/<版本> —— 下载解包产物（P1 落地后才有）
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

/** 数据根下 QQ 文件缓存目录名（<数据根>/qq-files/<版本>/，P1 下载解包产物）。 */
export const QQ_FILES_DIR_NAME = "qq-files";

/** 注册表 UninstallString 查询（QQ 官方安装路径）。 */
const REG_QUERY_RE = /"([^"]+)"/;

/** 注册表 UninstallString 查询（QQ 官方安装路径）。 */
function findQqViaRegistry(): string | null {
    try {
        const out = execFileSync("reg", [
            "query",
            "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ",
            "/v",
            "UninstallString",
        ]).toString();
        const m = out.match(REG_QUERY_RE);
        const exe = m?.[1];
        if (exe !== undefined) {
            // UninstallString 形如 "C:\...\uninst.exe" 或带参数
            const dir = exe.replaceAll('"', "").slice(0, exe.lastIndexOf("\\"));
            const qq = join(dir, "QQ.exe");
            if (existsSync(qq)) {
                return qq;
            }
        }
    } catch {
        // 注册表查询失败，走常见路径
    }
    return null;
}

/** 常见安装路径探测。 */
function findQqViaCommonPaths(): string | null {
    const localAppData = process.env["LOCALAPPDATA"] ?? "";
    const candidates = [
        "C:/Program Files/Tencent/QQNT/QQ.exe",
        "C:/Program Files (x86)/Tencent/QQNT/QQ.exe",
        join(localAppData, "Programs", "Tencent", "QQNT", "QQ.exe"),
        // 开发机目录（2026-08-07 环境事实：QQ 9.9.33-51802 在 C:\Dev\QQBot-Dev\QQNT）
        "C:/Dev/QQBot-Dev/QQNT/QQ.exe",
    ];
    for (const p of candidates) {
        if (existsSync(p)) {
            return p;
        }
    }
    return null;
}

/** QQ 文件来源。 */
export type QqFileSource = "local" | "cached";

/** QQ 安装目录探测结果。 */
export interface QqInstallInfo {
    /** QQ.exe 绝对路径（cached 来源为语义占位——缓存目录无 QQ.exe，当前无消费方）。 */
    qqPath: string;
    /** 安装根目录 / 文件根目录。 */
    installDir: string;
    /** 当前版本目录名（如 9.9.31-49919）。 */
    version: string;
    /** wrapper.node 绝对路径。 */
    wrapperPath: string;
    /** 来源：local = 本机安装；cached = NAPUTO_QQ_FILES / 数据根缓存。 */
    source: QqFileSource;
}

/** resolveQqFiles 选项。 */
export interface ResolveQqFilesOptions {
    /** 显式文件根（L0；缺省读 NAPUTO_QQ_FILES）。 */
    qqFilesDir?: string;
    /** 显式 QQ.exe 路径（L1；缺省读 NAPUTO_QQ_PATH）。 */
    qqPath?: string;
    /** 数据根（L2 缓存扫描；缺省轻量解析 NAPKETTO_DATA ?? 项目根/.napuketto）。 */
    dataRoot?: string;
}

/** 找 QQ.exe 路径。 */
export function locateQqPath(): string {
    const viaReg = findQqViaRegistry();
    if (viaReg) {
        return viaReg;
    }
    const viaCommon = findQqViaCommonPaths();
    if (viaCommon) {
        return viaCommon;
    }
    throw new Error("未找到 QQ.exe（请先安装 QQ，或通过 NAPUTO_QQ_PATH 指定）");
}

/** 从文件根定位最新版本 wrapper.node（local/cached 共用）。 */
function resolveFromRoot(rootDir: string, source: QqFileSource): QqInstallInfo {
    const versionsDir = join(rootDir, "versions");
    if (!existsSync(versionsDir)) {
        throw new Error(`QQ 版本目录不存在: ${versionsDir}`);
    }
    const versions = readdirSync(versionsDir)
        .filter((v) => statSync(join(versionsDir, v)).isDirectory())
        .sort()
        .reverse();
    const [first] = versions;
    if (first === undefined) {
        throw new Error(`QQ 版本目录为空: ${versionsDir}`);
    }
    const wrapperPath = join(versionsDir, first, "resources", "app", "wrapper.node");
    if (!existsSync(wrapperPath)) {
        throw new Error(`未找到 wrapper.node: ${wrapperPath}`);
    }
    return {
        qqPath: join(rootDir, "QQ.exe"),
        installDir: rootDir,
        version: first,
        wrapperPath,
        source,
    };
}

/** 从 QQ.exe 路径推导安装目录，并探测当前版本（L1：本机安装）。 */
export function resolveQqInstall(qqPath?: string): QqInstallInfo {
    const qq = qqPath ?? process.env["NAPUTO_QQ_PATH"] ?? locateQqPath();
    // Windows 安装结构：<installDir>/versions/<版本>/resources/app/wrapper.node
    const installDir = qq.slice(0, qq.lastIndexOf("\\"));
    return resolveFromRoot(installDir, "local");
}

/**
 * 多级来源定位 QQ 原生文件（P0：纯定位，自动下载在 P1）：
 *   L0 → L1 → L2 依次尝试，全部失败抛错。
 */
export function resolveQqFiles(options: ResolveQqFilesOptions = {}): QqInstallInfo {
    // L0：显式文件根（参数 > 环境变量）
    const explicitDir = options.qqFilesDir ?? process.env["NAPUTO_QQ_FILES"];
    if (explicitDir !== undefined && explicitDir !== "") {
        return resolveFromRoot(resolve(explicitDir), "cached");
    }
    // L1：本机安装（参数 > 环境变量 > 注册表/常见路径）
    const qqPath = options.qqPath ?? process.env["NAPUTO_QQ_PATH"];
    if (qqPath !== undefined && qqPath !== "") {
        return resolveQqInstall(qqPath);
    }
    try {
        return resolveQqInstall();
    } catch {
        // 本机未安装 → 落到 L2
    }
    // L2：数据根缓存（P1 下载解包产物；结构 <数据根>/qq-files/<版本>/）
    const cacheRoot = join(resolveDataRootLight(options.dataRoot), QQ_FILES_DIR_NAME);
    if (existsSync(cacheRoot)) {
        const versionDirs = readdirSync(cacheRoot)
            .filter((v) => statSync(join(cacheRoot, v)).isDirectory())
            .sort()
            .reverse();
        for (const versionDir of versionDirs) {
            try {
                return resolveFromRoot(join(cacheRoot, versionDir), "cached");
            } catch {
                // 该版本目录结构不完整（如下载中断残留），尝试下一个
            }
        }
    }
    throw new Error(
        "未找到 QQ 原生文件（wrapper.node）：请安装 QQ、设置 NAPUTO_QQ_PATH/NAPUTO_QQ_FILES，" +
            "或使用下载流程（P1）自动获取",
    );
}

/**
 * 轻量数据根解析（loader 侧，避免新增 kernel 依赖；P2 若需完整语义再切换）。
 * 优先级：显式参数 > NAPKETTO_DATA > 项目根/.napuketto > cwd 兜底。
 */
function resolveDataRootLight(dataRoot?: string): string {
    const explicit = dataRoot ?? process.env["NAPKETTO_DATA"];
    if (explicit !== undefined && explicit !== "") {
        return resolve(explicit);
    }
    const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
    return join(projectRoot, ".napuketto");
}

/** 向上探测项目根（含 pnpm-workspace.yaml 或 package.json 的目录）。 */
function findProjectRoot(start: string): string | null {
    let dir = resolve(start);
    for (;;) {
        if (existsSync(join(dir, "pnpm-workspace.yaml")) || existsSync(join(dir, "package.json"))) {
            return dir;
        }
        const parent = dirname(dir);
        if (parent === dir) {
            return null;
        }
        dir = parent;
    }
}
