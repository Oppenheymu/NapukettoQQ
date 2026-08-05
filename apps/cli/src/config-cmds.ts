/**
 * cli config 子命令：init / list / apply（P6，2026-08-05）
 *
 * 跨账号主配置放数据根，路径 `<dataRoot>/napuketto.json`：
 *   { dataDir, autoRestart, restartDelayMs, accounts: [{qq, enabled}] }
 *
 * 校验器为手写 parse（不引入 zod，适配 kernel ConfigBase 的 ConfigSchema 形状）。
 * 账号协议配置（onebot11.json 等）由运行时 ProtocolConfig.load() 自动生成。
 */

import type { Dirent } from "node:fs";
import { mkdirSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import type { ConfigSchema } from "@napuketto/kernel";
import { ConfigBase, kernelError, resolveDataRoot } from "@napuketto/kernel";

/** 主配置文件名。 */
const MAIN_CONFIG_FILE = "napuketto.json";

/** 默认自动重启。 */
const DEFAULT_AUTO_RESTART = true;
/** 默认重启延迟（毫秒）。 */
const DEFAULT_RESTART_DELAY_MS = 2000;

/** 账号配置项。 */
export interface CliAccountConfig {
    qq: string;
    enabled?: boolean;
}

/** 主配置（跨账号）。 */
export interface CliConfig {
    /** 数据根目录（绝对路径）。 */
    dataDir: string;
    /** supervisor 是否自动重启崩溃账号。 */
    autoRestart: boolean;
    /** 崩溃后重启延迟（毫秒）。 */
    restartDelayMs: number;
    /** 账号列表。 */
    accounts: CliAccountConfig[];
}

/** 主配置默认值（dataRoot 为当前解析的数据根）。 */
function defaultCliConfig(dataRoot: string): CliConfig {
    return {
        dataDir: dataRoot,
        autoRestart: DEFAULT_AUTO_RESTART,
        restartDelayMs: DEFAULT_RESTART_DELAY_MS,
        accounts: [],
    };
}

/** 手写校验器：主配置 parse（不引入 zod）。 */
function parseCliConfig(input: unknown): CliConfig {
    if (typeof input !== "object" || input === null) {
        throw kernelError("主配置必须是 JSON 对象", "INVALID_PARAM");
    }
    const raw = input as Record<string, unknown>;
    const dataDir = parseDataDir(raw);
    const autoRestart = parseAutoRestart(raw);
    const restartDelayMs = parseRestartDelayMs(raw);
    const accounts = parseAccounts(raw);
    return { dataDir, autoRestart, restartDelayMs, accounts };
}

/** 解析 dataDir（缺省用当前解析的数据根）。 */
function parseDataDir(raw: Record<string, unknown>): string {
    if (raw["dataDir"] === undefined) {
        return resolveDataRoot();
    }
    if (typeof raw["dataDir"] !== "string" || raw["dataDir"] === "") {
        throw kernelError("主配置 dataDir 必须是非空字符串", "INVALID_PARAM");
    }
    return raw["dataDir"];
}

/** 解析 autoRestart。 */
function parseAutoRestart(raw: Record<string, unknown>): boolean {
    if (raw["autoRestart"] === undefined) {
        return DEFAULT_AUTO_RESTART;
    }
    if (typeof raw["autoRestart"] !== "boolean") {
        throw kernelError("主配置 autoRestart 必须是布尔值", "INVALID_PARAM");
    }
    return raw["autoRestart"];
}

/** 解析 restartDelayMs（毫秒）。 */
function parseRestartDelayMs(raw: Record<string, unknown>): number {
    if (raw["restartDelayMs"] === undefined) {
        return DEFAULT_RESTART_DELAY_MS;
    }
    if (
        typeof raw["restartDelayMs"] !== "number" ||
        !Number.isInteger(raw["restartDelayMs"]) ||
        raw["restartDelayMs"] <= 0
    ) {
        throw kernelError("主配置 restartDelayMs 必须是正整数", "INVALID_PARAM");
    }
    return raw["restartDelayMs"];
}

/** 解析 accounts。 */
function parseAccounts(raw: Record<string, unknown>): CliAccountConfig[] {
    if (raw["accounts"] === undefined) {
        return [];
    }
    if (!Array.isArray(raw["accounts"])) {
        throw kernelError("主配置 accounts 必须是数组", "INVALID_PARAM");
    }
    const accounts: CliAccountConfig[] = [];
    for (const item of raw["accounts"]) {
        accounts.push(parseAccount(item));
    }
    return accounts;
}

/** 解析单个账号项。 */
function parseAccount(item: unknown): CliAccountConfig {
    if (typeof item !== "object" || item === null) {
        throw kernelError("主配置 accounts 元素必须是对象", "INVALID_PARAM");
    }
    const { qq, enabled } = item as { qq?: unknown; enabled?: unknown };
    if (typeof qq !== "string" || qq === "") {
        throw kernelError("主配置账号缺少非空 qq", "INVALID_PARAM");
    }
    const out: CliAccountConfig = { qq };
    if (enabled !== undefined) {
        if (typeof enabled !== "boolean") {
            throw kernelError("主配置账号 enabled 必须是布尔值", "INVALID_PARAM");
        }
        out.enabled = enabled;
    }
    return out;
}

/** 主配置 store（读/写/校验）。 */
export class CliConfigStore extends ConfigBase<CliConfig> {
    constructor(dataRoot: string) {
        super({
            path: join(dataRoot, MAIN_CONFIG_FILE),
            schema: { parse: parseCliConfig } satisfies ConfigSchema<CliConfig>,
            defaults: defaultCliConfig(dataRoot),
        });
    }
}

/** 读取主配置（缺失自动落默认）。 */
export async function loadCliConfig(dataRoot: string): Promise<CliConfig> {
    const store = new CliConfigStore(dataRoot);
    return await store.load();
}

/** config init：生成主配置 + 数据根目录。 */
export async function cmdConfigInit(opts: { dataDir?: string }): Promise<void> {
    const dataRoot = resolveDataRoot(opts.dataDir);
    mkdirSync(dataRoot, { recursive: true });
    const store = new CliConfigStore(dataRoot);
    const config = await store.load();
    process.stdout.write(`[napuketto] 主配置已就绪: ${store.path}\n`);
    process.stdout.write(`${JSON.stringify(config, null, 4)}\n`);
}

/** config list：列出主配置与各账号配置目录。 */
export async function cmdConfigList(opts: { dataDir?: string }): Promise<void> {
    const dataRoot = resolveDataRoot(opts.dataDir);
    const store = new CliConfigStore(dataRoot);
    const config = await store.load();
    process.stdout.write(`[napuketto] 数据根: ${dataRoot}\n`);
    process.stdout.write(`[napuketto] 主配置: ${store.path}\n`);
    process.stdout.write(`${JSON.stringify(config, null, 4)}\n`);
    // 账号目录（数据根下的子目录）
    let entries: Dirent[];
    try {
        entries = readdirSync(dataRoot, { withFileTypes: true });
    } catch {
        entries = [];
    }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            printAccountConfig(entry.name, dataRoot);
        }
    }
}

/** 打印账号 config 目录文件清单。 */
function printAccountConfig(name: string, dataRoot: string): void {
    const configDir = join(dataRoot, name, "config");
    let files: string[] = [];
    try {
        files = readdirSync(configDir).filter((f) => f.endsWith(".json"));
    } catch {
        files = [];
    }
    let fileList = "（未初始化）";
    if (files.length > 0) {
        fileList = files.join(", ");
    }
    process.stdout.write(`[napuketto] 账号 ${name} → config: ${fileList}\n`);
}

/** config apply：应用外部配置（顶层覆盖合并后写回主配置）。 */
export async function cmdConfigApply(file: string, opts: { dataDir?: string }): Promise<void> {
    const dataRoot = resolveDataRoot(opts.dataDir);
    const store = new CliConfigStore(dataRoot);
    const existing = await store.load();
    let rawText: string;
    try {
        rawText = await readFile(file, "utf8");
    } catch (err) {
        let message = String(err);
        if (err instanceof Error) {
            const { message: errMessage } = err;
            message = errMessage;
        }
        throw kernelError(`读取外部配置失败 ${file}: ${message}`, "INVALID_PARAM", { cause: err });
    }
    let partial: unknown;
    try {
        partial = JSON.parse(rawText);
    } catch {
        throw kernelError(`外部配置 ${file} 不是合法 JSON`, "INVALID_PARAM");
    }
    if (typeof partial !== "object" || partial === null) {
        throw kernelError("外部配置必须是 JSON 对象", "INVALID_PARAM");
    }
    const patch = partial as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...existing, ...patch };
    const next = parseCliConfig(merged);
    await store.save(next);
    process.stdout.write(`[napuketto] 主配置已更新: ${store.path}\n`);
    process.stdout.write(`${JSON.stringify(next, null, 4)}\n`);
}
