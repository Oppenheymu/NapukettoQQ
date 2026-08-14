/**
 * qq-extract.ts：QQ 官方安装包解包与提取（P1）。
 *
 * ⚠️ 格式事实（2026-08-12 实测修正）：QQ 官方安装包是 NSIS 自解压格式，
 * **7za standalone 不支持 NSIS**（只支持 7z/zip/tar 等）——必须用完整版
 * 7z（7z.exe + 7z.dll）。设计文档 §2.3 原「内置 7za.exe」修正为：
 *  - Windows：内置 assets/7zip/7z.exe + 7z.dll（7-Zip 官方，LGPL 合规可分发）
 *  - Linux/Docker：系统 p7zip-full（7z 完整版）
 *
 * ⚠️ 提取策略（2026-08-12 实测修正，与设计 §2.3 不同）：
 *  1. NSIS 解包产物在 <extracted>/Files/（NSIS 内部布局），Files/ = 安装根
 *  2. 真实 QQNT.dll（214MB）位于 versions/<v>/QQNT.dll，**自建宿主不需要**
 *     ——stub QQNT.dll 已替代其宿主符号职责（wrapper.node 的 v8/node/napi/qq_magic
 *     符号由 stub 转发到 node.exe）
 *  3. 只提取 resources/app 顶层 *.node + *.dll（wrapper.node 的直接/传递/delay-load
 *     依赖全覆盖，版本无关；跳过 wmpfsdk/avsdk 等大子目录，共约 235MB）
 *
 * 提取目标（与安装目录同构，resolveFromRoot 可直接消费）：
 *   <数据根>/qq-files/<版本>/versions/<版本>/resources/app/   ← *.node + *.dll
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { QqInstallInfo } from "./locate-qq.js";

/** resources/app 下需要提取的文件扩展名（.node 原生模块 + .dll 依赖）。 */
const EXTRACT_EXTENSIONS = new Set([".node", ".dll"]);

/** 7-Zip 可执行文件来源。 */
export interface SevenZipResult {
    /** 7z 可执行文件绝对路径。 */
    exe: string;
    /** 来源说明（内置资产 / 系统 / 环境变量）。 */
    source: string;
}

/** 提取选项。 */
export interface ExtractOptions {
    /** 安装包绝对路径。 */
    installerPath: string;
    /** 目标版本目录（如 9.9.33-51802）。 */
    version: string;
    /** 缓存根目录（<数据根>/qq-files；版本子目录将建在其下）。 */
    cacheRoot: string;
    /** 7z 可执行文件路径（缺省自动探测）。 */
    sevenZipPath?: string;
}

/**
 * 探测 7z 可执行文件：
 *   NAPUTO_7Z_PATH 环境变量 > 内置资产（assets/7zip/7z.exe，Windows）> 系统 PATH 7z。
 * Linux 上用 p7zip 提供的 7z 命令（系统 PATH）。
 */
export function findSevenZip(): SevenZipResult {
    const envPath = process.env["NAPUTO_7Z_PATH"];
    if (envPath !== undefined && envPath !== "" && existsSync(envPath)) {
        return { exe: envPath, source: "环境变量 NAPUTO_7Z_PATH" };
    }
    // 内置资产：dist 与 assets 同层（tsdown 构建后 dist/，资产在包根 assets/）
    if (process.platform === "win32") {
        const bundled = join(
            dirname(fileURLToPath(import.meta.url)),
            "..",
            "assets",
            "7zip",
            "7z.exe",
        );
        if (existsSync(bundled)) {
            return { exe: bundled, source: "内置资产 assets/7zip" };
        }
    }
    // 系统 PATH（Windows 装了 7-Zip 有 7z.exe；Linux p7zip-full 提供 7z 命令）
    return { exe: "7z", source: "系统 PATH" };
}

/** 解包安装包到指定目录（spawn 7z x，失败抛错）。 */
export async function extractInstaller(
    installerPath: string,
    destDir: string,
    sevenZipPath?: string,
): Promise<void> {
    const sevenZip = sevenZipPath ?? findSevenZip().exe;
    await mkdir(destDir, { recursive: true });
    await new Promise<void>((resolve, reject) => {
        execFile(
            sevenZip,
            ["x", installerPath, `-o${destDir}`, "-y"],
            { maxBuffer: 64 * 1024 * 1024 },
            (err, _stdout, stderr) => {
                if (err !== null) {
                    const code = (err as NodeJS.ErrnoException).code;
                    const hint =
                        code === "ENOENT"
                            ? `未找到 7z 可执行文件: ${sevenZip}\n` +
                              "（Windows 请安装 7-Zip 或用 NAPUTO_7Z_PATH 指定；" +
                              "Linux 自动下载失败时请安装 p7zip-full 或用 NAPUTO_7Z_PATH 指定）"
                            : "（QQ 安装包是 NSIS 格式，需完整版 7z 而非 7za）";
                    reject(new Error(`7z 解包失败: ${installerPath}\n${stderr.trim()}\n${hint}`));
                    return;
                }
                resolve();
            },
        );
    });
}

/**
 * 从解包目录提取运行所需文件到缓存：
 * resources/app 顶层全部 *.node + *.dll（保持同目录结构，PATH 前置即可解析依赖）。
 * 幂等：目标 wrapper.node 已存在则跳过。
 */
export async function extractWrapperFiles(
    extractedDir: string,
    version: string,
    cacheRoot: string,
): Promise<QqInstallInfo> {
    // NSIS 解包产物在 <extracted>/Files/（安装根），resources/app 在其下
    const appDir = join(extractedDir, "Files", "versions", version, "resources", "app");
    if (!existsSync(join(appDir, "wrapper.node"))) {
        throw new Error(`解包产物缺少 wrapper.node: ${appDir}`);
    }

    // 目标结构（与安装目录同构）：
    //   <cacheRoot>/<version>/versions/<version>/resources/app/*.{node,dll}
    const destAppDir = join(cacheRoot, version, "versions", version, "resources", "app");
    const destWrapper = join(destAppDir, "wrapper.node");

    // 幂等：已提取过则跳过
    if (existsSync(destWrapper)) {
        return buildCachedInfo(cacheRoot, version);
    }

    await mkdir(destAppDir, { recursive: true });
    const entries = await readdir(appDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isFile()) {
            continue; // 跳过子目录（wmpfsdk/avsdk 等大目录不需要）
        }
        const dot = entry.name.lastIndexOf(".");
        const ext = dot >= 0 ? entry.name.slice(dot).toLowerCase() : "";
        if (!EXTRACT_EXTENSIONS.has(ext)) {
            continue; // 只提取 .node + .dll
        }
        await copyFile(join(appDir, entry.name), join(destAppDir, entry.name));
    }
    if (!existsSync(destWrapper)) {
        throw new Error(`提取失败：wrapper.node 未复制到 ${destWrapper}`);
    }

    return buildCachedInfo(cacheRoot, version);
}

/** 构造 cached 来源的 QqInstallInfo（wrapperPath 指向缓存中 wrapper.node）。 */
function buildCachedInfo(cacheRoot: string, version: string): QqInstallInfo {
    const versionDir = join(cacheRoot, version);
    return {
        qqPath: join(versionDir, "QQ.exe"), // 语义占位（缓存目录无 QQ.exe）
        installDir: versionDir,
        version,
        wrapperPath: join(versionDir, "versions", version, "resources", "app", "wrapper.node"),
        source: "cached",
    };
}

/** 清理缓存版本目录（下载/解包失败残留，供调用方兜底）。 */
export async function clearCacheVersion(cacheRoot: string, version: string): Promise<void> {
    await rm(join(cacheRoot, version), { recursive: true, force: true });
}
