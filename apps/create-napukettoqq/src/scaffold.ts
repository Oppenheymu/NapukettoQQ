/**
 * create-napukettoqq 脚手架核心：模板渲染 + 目标目录创建 + 文件写入。
 *
 * 模板为独立文件（templates/ 目录，运行时读取），不硬编码在源码里；
 * 需要插值的占位符用 {{key}} 标记（见 renderTemplate）。
 * 依赖极轻（node:fs/promises / node:os / node:path / node:process）。
 * 生成的用户项目依赖发布版的 @napuketto/cli，用户 install 后经 cli → loader
 * 自建宿主启动。
 */

import { readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

/** 模板目录（相对本文件：src 与 dist 都在包根下，../templates 均指向包根/templates）。 */
const TEMPLATES = new URL("../templates/", import.meta.url);

/**
 * 生成的用户项目所依赖的 @napuketto/cli 版本范围。
 * 运行时从脚手架自身 package.json 读取（dependencies["@napuketto/cli"]）——
 * 发版时 changesets 升版本 + pnpm publish 把 workspace:* 替换为实际版本，
 * 模板版本自动跟随，无需手动同步（比硬编码常量可靠）。
 */
export function cliVersionRange(): string {
    try {
        const ownPkg = JSON.parse(
            readFileSync(new URL("../package.json", import.meta.url), "utf8"),
        ) as { dependencies?: Record<string, string> };
        const range = ownPkg.dependencies?.["@napuketto/cli"];
        // workspace:* 仅在本地 monorepo 直跑脚手架时出现（发布后 pnpm 替换为实际版本），
        // 此时兜底默认范围，避免生成的用户项目 install 失败
        if (range !== undefined && range !== "workspace:*") {
            return range;
        }
    } catch {
        // package.json 缺失（异常环境）→ 兜底默认范围
    }
    return "^0.0.1";
}

/** 默认部署文件夹名（用户交互回车缺省值）。 */
export const DEFAULT_PROJECT_NAME = "NapukettoQQ";

/** 用户可用的包管理器（npm_config_user_agent 检测）。 */
export type PackageManager = "pnpm" | "yarn" | "npm";

/**
 * 由 npm_config_user_agent 检测调用方包管理器（yarn create / npm create /
 * pnpm create 都会注入该变量）。兜底 pnpm（项目生态，或直接 node 运行）。
 */
export function detectPackageManager(): PackageManager {
    // noPropertyAccessFromIndexSignature：process.env 是索引签名，必须括号访问
    const ua = process.env["npm_config_user_agent"] ?? "";
    if (ua.startsWith("yarn/")) {
        return "yarn";
    }
    if (ua.startsWith("npm/")) {
        return "npm";
    }
    return "pnpm";
}

/** Windows 下包管理器 bin 需带 .cmd 后缀（CreateProcess 不认无扩展名 shim）。 */
export function pmBin(pm: PackageManager): string {
    return process.platform === "win32" ? `${pm}.cmd` : pm;
}

/** Windows 路径非法字符（项目文件夹名校验用）。 */
const ILLEGAL_NAME = /[\\/:*?"<>|]/;

/** 脚手架生成结果。 */
export interface ScaffoldResult {
    /** 目标目录绝对路径。 */
    dir: string;
    /** 派生出的 npm 包名（小写、空格 → -）。 */
    packageName: string;
}

/** 校验文件夹名：非空、非 . / ..、不含 Windows 非法字符。 */
export function validateProjectName(raw: string): string {
    const name = raw.trim();
    if (name === "" || name === "." || name === "..") {
        throw new Error("文件夹名不能为空或为 . / ..");
    }
    if (ILLEGAL_NAME.test(name)) {
        throw new Error(`文件夹名含非法字符：${name}（不允许 \\ / : * ? " < > |）`);
    }
    return name;
}

/** 由文件夹名派生 npm 包名（小写、空格 → -）。 */
export function derivePackageName(dirName: string): string {
    return dirName.toLowerCase().replace(/\s+/g, "-");
}

/** 解析目标目录绝对路径（校验名称后，基于 cwd）。 */
export function resolveTargetDir(dirName: string): string {
    return path.resolve(process.cwd(), validateProjectName(dirName));
}

/** 目标目录状态：不存在 / 空 / 非空。 */
export type DirStatus = "missing" | "empty" | "nonempty";

/** 检测目标目录状态（供交互层决定是否询问清空）。 */
export async function checkDirStatus(dir: string): Promise<DirStatus> {
    let entries: string[] = [];
    try {
        entries = await readdir(dir);
    } catch {
        return "missing";
    }
    return entries.length === 0 ? "empty" : "nonempty";
}

/** 清空目录内容（保留目录本身）。 */
export async function emptyDir(dir: string): Promise<void> {
    for (const entry of await readdir(dir)) {
        await rm(path.join(dir, entry), { recursive: true, force: true });
    }
}

/** 读取模板文件（templates/ 目录，UTF-8）。 */
function readTemplate(file: string): Promise<string> {
    return readFile(new URL(file, TEMPLATES), "utf8");
}

/**
 * 占位符渲染：把 {{key}} 替换为 vars[key]。
 * 模板中出现未提供的占位符 → 抛错（防漏插值写出半成品）。
 */
function renderTemplate(content: string, vars: Record<string, string>): string {
    return content.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
        const value = vars[key];
        if (value === undefined) {
            throw new Error(`模板占位符未提供：{{${key}}}（模板 ${match} 无法渲染）`);
        }
        return value;
    });
}

/**
 * 生成 NapukettoQQ 项目骨架到当前目录下的 <dirName>/。
 * 目标目录已存在且非空：overwrite=false → 抛错；overwrite=true → 清空后生成。
 * 模板与写入目标一一对应（同文件名）。
 */
export async function scaffoldProject(dirName: string, overwrite = false): Promise<ScaffoldResult> {
    const name = validateProjectName(dirName);
    const packageName = derivePackageName(name);
    const dir = resolveTargetDir(name);

    const status = await checkDirStatus(dir);
    if (status === "nonempty" && !overwrite) {
        throw new Error(`目录已存在且非空：${dir}\n请换一个文件夹名，或先清空该目录。`);
    }
    if (status === "nonempty") {
        await emptyDir(dir);
    }

    // 渲染变量：dataDir 用 JSON.stringify 转义反斜杠 → TOML 基本字符串合法写法
    const vars: Record<string, string> = {
        packageName,
        cliVersion: cliVersionRange(),
        dataDir: JSON.stringify(path.join(homedir(), ".napuketto")),
    };
    // 用户项目是「运行壳」：不开发代码，只需 package.json（依赖 + start）+ napuketto.toml（配置）
    const files = ["package.json", "napuketto.toml"];

    await mkdir(dir, { recursive: true });
    for (const file of files) {
        const rendered = renderTemplate(await readTemplate(file), vars);
        await writeFile(path.join(dir, file), rendered, "utf8");
    }

    return { dir, packageName };
}
