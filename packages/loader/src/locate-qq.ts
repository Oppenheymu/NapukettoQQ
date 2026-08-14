/**
 * 定位 QQ 原生文件（wrapper.node）来源（P0：多级来源纯定位，不下载）。
 *
 * 来源优先级（resolveQqFiles）：
 *   L0: NAPUTO_QQ_FILES / qqFilesDir —— 显式指定含 versions/ 结构的文件根（缓存/拷贝）
 *   L1: 本机 QQ 安装 —— NAPUTO_QQ_PATH / 注册表 / 常见路径（既有逻辑保留）
 *   L2: 数据根缓存 <数据根>/qq-files/<版本> —— 下载解包产物（P1 落地后才有）
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { chmod, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { downloadFile } from "./qq-download.js";
import { clearCacheVersion, extractInstaller, extractWrapperFiles } from "./qq-extract.js";
import { latestRelease, loadQqReleases, resolveDownloadUrl } from "./qq-releases.js";

/** 数据根下 QQ 文件缓存目录名（<数据根>/qq-files/<版本>/，P1 下载解包产物）。 */
export const QQ_FILES_DIR_NAME = "qq-files";

/** 7-Zip 官方 Linux 版版本号（tar.xz 文件名组成部分，2026-08-14 起自动下载）。 */
const SEVEN_ZIP_LINUX_VERSION = "2409";

/** 注册表 UninstallString 查询（QQ 官方安装路径）。 */
const REG_QUERY_RE = /"([^"]+)"/;

/** Windows 盘符路径正则（`C:/...` / `C:\...`，wslMappedPath 映射用，模块级常量）。 */
const DRIVE_PATH_RE = /^([A-Za-z]):[\\/](.*)$/;

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
        // WSL 场景：Windows 盘挂载在 /mnt/<盘符>/（如 C:\ → /mnt/c/），
        // 同一候选同时探测 Linux 侧映射路径（2026-08-13 koishi-app 实测报「未找到 QQ.exe」）。
        const wsl = wslMappedPath(p);
        if (existsSync(wsl)) {
            return wsl;
        }
        if (existsSync(p)) {
            return p;
        }
    }
    return null;
}

/**
 * Windows 路径 → WSL 挂载路径（`C:/...` → `/mnt/c/...`；非 Linux 或非盘符路径原样）。
 * WSL 默认把 Windows 盘符挂载到 `/mnt/<小写盘符>/`，Linux 侧 `existsSync` 必须用映射路径。
 * platform 参数可注入（测试用；缺省 process.platform）。
 * 导出便于单测（locate-qq.test.ts）。
 * ⚠️ 不用 join 拼 `/mnt/...`：测试在 Windows 跑，win32 join 会产生反斜杠；目标路径
 * 是 Linux 侧路径（WSL 挂载点），必须恒正斜杠。
 */
export function wslMappedPath(
    winPath: string,
    platform: NodeJS.Platform = process.platform,
): string {
    if (platform !== "linux") {
        return winPath;
    }
    const [, drive, rest] = DRIVE_PATH_RE.exec(winPath) ?? [];
    if (drive === undefined || rest === undefined) {
        return winPath;
    }
    return `/mnt/${drive.toLowerCase()}/${rest.replaceAll("\\", "/")}`;
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
    /** L0/L1/L2 全部失败时自动进入下载流程（P1；默认 true，测试可关）。 */
    autoDownload?: boolean;
    /** 7z 可执行文件路径（解包用；缺省自动探测）。 */
    sevenZipPath?: string;
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
    // ⚠️ dirname 跨平台：Linux/WSL 路径用正斜杠（lastIndexOf("\\") 会切错，2026-08-13 实测）
    const installDir = dirname(qq);
    return resolveFromRoot(installDir, "local");
}

/**
 * 多级来源定位 QQ 原生文件：
 *   L0 → L1 → L2 依次尝试，全部失败且 autoDownload 时自动进入下载流程（ensureQqFiles）。
 * ⚠️ async：自动下载为异步流程（P1 起）；纯定位场景用 resolveQqInstall（同步）。
 */
export async function resolveQqFiles(options: ResolveQqFilesOptions = {}): Promise<QqInstallInfo> {
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
        // 本机未安装 → 落 L2
    }
    // L2：数据根缓存（P1 下载解包产物；结构 <数据根>/qq-files/<版本>/）
    const dataRoot = resolveDataRootLight(options.dataRoot);
    const cached = tryResolveCached(dataRoot);
    if (cached !== null) {
        return cached;
    }
    // 全部缺失 → 自动下载（P1）
    if (options.autoDownload !== false) {
        const sevenZipPath =
            options.sevenZipPath !== undefined ? { sevenZipPath: options.sevenZipPath } : {};
        return ensureQqFiles({ dataRoot, ...sevenZipPath });
    }
    throw new Error(
        "未找到 QQ 原生文件（wrapper.node）：请安装 QQ、设置 NAPUTO_QQ_PATH/NAPUTO_QQ_FILES，" +
            "或使用下载流程（ensureQqFiles）自动获取",
    );
}

/** 扫描数据根缓存（L2）；命中返回，未命中返回 null。 */
function tryResolveCached(dataRoot: string): QqInstallInfo | null {
    const cacheRoot = join(dataRoot, QQ_FILES_DIR_NAME);
    if (!existsSync(cacheRoot)) {
        return null;
    }
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
    return null;
}

/**
 * 7-Zip 官方 Linux 版下载地址（纯函数，可单测）。
 * 环境变量 NAPUTO_7Z_URL 可覆盖（同 QQ 下载 NAPUTO_QQ_URL 模式）。
 */
export function linuxSevenZipUrl(): string {
    return (
        process.env["NAPUTO_7Z_URL"] ??
        `https://www.7-zip.org/a/7z${SEVEN_ZIP_LINUX_VERSION}-linux-x64.tar.xz`
    );
}

/**
 * 确保 Linux 7zz 就绪（2026-08-14 生产修复）：自动下载 7-Zip 官方 Linux 版。
 *
 * 背景：内置 assets/7zip 的 7z.exe 是 Windows PE（Linux 不可用），此前 Linux 依赖
 * 系统 p7zip-full——生产环境未安装 → `7z 解包失败: No such file or directory`。
 * 7zz 是 7-Zip 完整版（支持 NSIS 解包，同 7z.exe 能力），官方静态二进制，
 * 免 root 免系统包，下载到 <数据根>/runtime/7zip/7zz（与 win-node 同模式）。
 *
 * 幂等：缓存已存在直接返回；tar -xJf 解压（Linux 自带 tar；需 xz-utils）。
 */
export async function ensureLinuxSevenZip(
    options: { dataRoot?: string } = {},
): Promise<{ exe: string; source: string }> {
    const dataRoot = resolveDataRootLight(options.dataRoot);
    const cacheDir = join(dataRoot, "runtime", "7zip");
    const exe = join(cacheDir, "7zz");
    if (existsSync(exe)) {
        return { exe, source: "数据根缓存 runtime/7zip" };
    }

    const archive = join(cacheDir, `7z${SEVEN_ZIP_LINUX_VERSION}-linux-x64.tar.xz`);
    mkdirSync(cacheDir, { recursive: true });
    await downloadFile({ dest: archive, url: linuxSevenZipUrl() });
    try {
        // tar -xJf 解压（Linux 自带 tar；7-Zip 官方 tar.xz 根目录含 7zz）
        try {
            execFileSync("tar", ["-xJf", archive, "-C", cacheDir], { stdio: "pipe" });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(
                `7z linux 解压失败: ${message}（需 tar + xz-utils；或设 NAPUTO_7Z_PATH 指定系统 7z）`,
            );
        }
    } finally {
        await rm(archive, { force: true });
    }
    if (!existsSync(exe)) {
        throw new Error(`7z linux 解压后未找到 7zz: ${exe}`);
    }
    await chmod(exe, 0o755); // 官方 tar.xz 内已有执行位，保险设置
    return { exe, source: "自动下载（7-Zip 官方 linux 版）" };
}

/**
 * 确保 QQ 原生文件就绪（P1）：幂等缓存检查 → 下载官方安装包 → sha256 校验
 * → 7z 解包 → 提取 wrapper.node/QQNT.dll → 缓存。返回缓存版本 QqInstallInfo。
 */
export async function ensureQqFiles(
    options: {
        /** 数据根（缓存 <数据根>/qq-files/）。 */
        dataRoot?: string;
        /** 7z 路径（缺省自动探测）。 */
        sevenZipPath?: string;
    } = {},
): Promise<QqInstallInfo> {
    const dataRoot = resolveDataRootLight(options.dataRoot);
    const cacheRoot = join(dataRoot, QQ_FILES_DIR_NAME);
    mkdirSync(cacheRoot, { recursive: true });

    // 幂等：缓存已有完整版本 → 直接返回
    const existing = tryResolveCached(dataRoot);
    if (existing !== null) {
        return existing;
    }

    // 1. 版本清单 → 最新可用版本
    const releases = loadQqReleases();
    const release = latestRelease(releases);
    const url = resolveDownloadUrl(release);
    const version = release.version;

    // 2. 下载 + sha256 校验（清单无参考值时下载器跳过校验，完整性由解包/加载兜底）
    const tmpDir = join(dataRoot, "tmp");
    mkdirSync(tmpDir, { recursive: true });
    const installerPath = join(tmpDir, `qq-installer-${version}.exe`);
    await downloadFile({ dest: installerPath, url, expectedSha256: release.sha256 });

    // 3. 解包 + 提取（失败清理缓存残留；临时文件无论如何清理）
    //    Linux 分支：确保 7zz（自动下载 7-Zip 官方 linux 版，2026-08-14 生产修复——
    //    此前依赖系统 p7zip-full，未安装则 7z 解包失败、QQ 文件无法就绪）
    let sevenZipPath = options.sevenZipPath;
    if (sevenZipPath === undefined && process.platform === "linux") {
        sevenZipPath = (await ensureLinuxSevenZip({ dataRoot })).exe;
    }
    const extractedDir = join(tmpDir, `qq-extracted-${version}`);
    try {
        await extractInstaller(installerPath, extractedDir, sevenZipPath);
        const info = await extractWrapperFiles(extractedDir, version, cacheRoot);
        return info;
    } catch (err) {
        await clearCacheVersion(cacheRoot, version);
        throw err;
    } finally {
        await rm(installerPath, { force: true });
        await rm(extractedDir, { recursive: true, force: true });
    }
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
