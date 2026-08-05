/**
 * 定位 QQ 安装目录与版本（复用 kernel wrapper-version 的探测逻辑）
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

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
    ];
    for (const p of candidates) {
        if (existsSync(p)) {
            return p;
        }
    }
    return null;
}

/** QQ 安装目录探测结果。 */
export interface QqInstallInfo {
    /** QQ.exe 绝对路径。 */
    qqPath: string;
    /** 安装根目录。 */
    installDir: string;
    /** 当前版本目录名（如 9.9.31-49919）。 */
    version: string;
    /** wrapper.node 绝对路径。 */
    wrapperPath: string;
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

/** 从 QQ.exe 路径推导安装目录，并探测当前版本。 */
export function resolveQqInstall(qqPath?: string): QqInstallInfo {
    const qq = qqPath ?? process.env["NAPUTO_QQ_PATH"] ?? locateQqPath();
    const installDir = qq.slice(0, qq.lastIndexOf("\\"));
    const versionsDir = join(installDir, "versions");
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
    return { qqPath: qq, installDir, version: first, wrapperPath };
}
