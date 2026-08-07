/**
 * cli config 子命令：init / list / apply（P6，2026-08-05；2026-08-07 配置文件移到项目根）
 *
 * **全局单配置文件**：`<项目根>/napuketto.toml`（2026-08-07 用户拍板：配置文件放项目根，
 * 数据仍按数据根组织），本项目所有配置都在里面管理（TOML + smol-toml，配合 zod 校验，
 * 用户 2026-08-05 拍板：JSON 门槛太高）：
 *
 *   dataDir = "C:\\...\\.napuketto"   # 数据根（账号目录/日志/缓存/QQ 数据），与配置文件位置解耦
 *   autoRestart = true
 *   restartDelayMs = 2000
 *   [[accounts]]
 *   qq = "123456"
 *   enabled = true
 *   [onebot11]                 # 协议段，与 ob11ConfigSchema 对应
 *   heartbeatInterval = 3000
 *   [onebot11.http]            # 嵌套表
 *   enabled = false
 *   host = "127.0.0.1"
 *   port = 3000
 *
 * 配置文件路径解析见 kernel `resolveConfigPath`（NAPKETTO_CONFIG 显式 > 项目根探测 > cwd > 数据根兜底）；
 * 校验器为手写 parse（适配 kernel ConfigBase 的 ConfigSchema 形状）；
 * 协议段由对应协议包的 zod schema 校验（boot.cjs 装配时经 seed 传入）。
 */
import type { Dirent } from "node:fs";
import { mkdirSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import process from "node:process";
import type { ConfigSchema } from "@napuketto/kernel";
import {
    ConfigBase,
    kernelError,
    parseToml,
    resolveConfigPath,
    resolveDataRoot,
    stringifyToml,
} from "@napuketto/kernel";

/** 默认自动重启。 */
const DEFAULT_AUTO_RESTART = true;
/** 默认重启延迟（毫秒）。 */
const DEFAULT_RESTART_DELAY_MS = 2000;

/** 账号配置项。 */
export interface CliAccountConfig {
    qq: string;
    enabled?: boolean;
}

/** 主配置（跨账号，全局单文件 TOML）。 */
export interface CliConfig {
    /** 数据根目录（绝对路径）。 */
    dataDir: string;
    /** supervisor 是否自动重启崩溃账号。 */
    autoRestart: boolean;
    /** 崩溃后重启延迟（毫秒）。 */
    restartDelayMs: number;
    /** 账号列表。 */
    accounts: CliAccountConfig[];
    /** onebot11 协议段（与 ob11ConfigSchema 对应，宽松对象，装配时 zod 校验）。 */
    onebot11?: Record<string, unknown>;
}

/** 主配置默认值（dataRoot 为当前解析的数据根）。 */
function defaultCliConfig(dataRoot: string): CliConfig {
    return {
        dataDir: dataRoot,
        autoRestart: DEFAULT_AUTO_RESTART,
        restartDelayMs: DEFAULT_RESTART_DELAY_MS,
        accounts: [],
        onebot11: {},
    };
}

/** 手写校验器：主配置 parse（不引入 zod）。 */
function parseCliConfig(input: unknown): CliConfig {
    if (typeof input !== "object" || input === null) {
        throw kernelError("主配置必须是对象", "INVALID_PARAM");
    }
    const raw = input as Record<string, unknown>;
    const dataDir = parseDataDir(raw);
    const autoRestart = parseAutoRestart(raw);
    const restartDelayMs = parseRestartDelayMs(raw);
    const accounts = parseAccounts(raw);
    const onebot11 = parseOnebot11(raw);
    const out: CliConfig = { dataDir, autoRestart, restartDelayMs, accounts };
    if (onebot11 !== undefined) {
        out.onebot11 = onebot11;
    }
    return out;
}

/** 解析 onebot11 段（宽松对象，装配时由 zod schema 严格校验）。 */
function parseOnebot11(raw: Record<string, unknown>): Record<string, unknown> | undefined {
    if (raw["onebot11"] === undefined) {
        return;
    }
    if (typeof raw["onebot11"] !== "object" || raw["onebot11"] === null) {
        throw kernelError("主配置 onebot11 段必须是对象", "INVALID_PARAM");
    }
    return raw["onebot11"] as Record<string, unknown>;
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

/** 主配置 store（读/写/校验；.toml 后缀 → smol-toml 序列化）。
 * 配置文件在项目根（resolveConfigPath），dataRoot 仅作兜底与 dataDir 默认值。 */
export class CliConfigStore extends ConfigBase<CliConfig> {
    constructor(dataRoot: string) {
        super({
            path: resolveConfigPath({ dataRoot }),
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

/** CliConfig → 普通对象（smol-toml stringify 入参）。 */
function toRecord(config: CliConfig): Record<string, unknown> {
    return config as unknown as Record<string, unknown>;
}

/** config init：生成全局 TOML 配置文件（项目根）+ 数据根目录。 */
export async function cmdConfigInit(opts: { dataDir?: string }): Promise<void> {
    const dataRoot = resolveDataRoot(opts.dataDir);
    mkdirSync(dataRoot, { recursive: true });
    const store = new CliConfigStore(dataRoot);
    const config = await store.load();
    process.stdout.write(`[napuketto] 数据根: ${dataRoot}\n`);
    process.stdout.write(`[napuketto] 全局配置已就绪: ${store.path}\n`);
    process.stdout.write(`${stringifyToml(toRecord(config))}\n`);
}

/** config list：列出全局配置与各账号目录。 */
export async function cmdConfigList(opts: { dataDir?: string }): Promise<void> {
    const dataRoot = resolveDataRoot(opts.dataDir);
    const store = new CliConfigStore(dataRoot);
    const config = await store.load();
    process.stdout.write(`[napuketto] 数据根: ${dataRoot}\n`);
    process.stdout.write(`[napuketto] 全局配置: ${store.path}\n`);
    process.stdout.write(`${stringifyToml(toRecord(config))}\n`);
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
        files = readdirSync(configDir).filter((f) => f.endsWith(".json") || f.endsWith(".toml"));
    } catch {
        files = [];
    }
    let fileList = "（未初始化）";
    if (files.length > 0) {
        fileList = files.join(", ");
    }
    process.stdout.write(`[napuketto] 账号 ${name} → config: ${fileList}\n`);
}

/** 解析外部配置文本（按扩展名推断 TOML/JSON）。 */
function parseExternalConfig(file: string, rawText: string): unknown {
    if (extname(file).toLowerCase() === ".toml") {
        return parseToml(rawText);
    }
    try {
        return JSON.parse(rawText) as unknown;
    } catch {
        throw kernelError(`外部配置 ${file} 不是合法 JSON`, "INVALID_PARAM");
    }
}

/** config apply：应用外部配置（顶层覆盖合并后写回全局配置）。 */
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
    const partial = parseExternalConfig(file, rawText);
    if (typeof partial !== "object" || partial === null) {
        throw kernelError("外部配置必须是对象", "INVALID_PARAM");
    }
    const patch = partial as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...existing, ...patch };
    const next = parseCliConfig(merged);
    await store.save(next);
    process.stdout.write(`[napuketto] 全局配置已更新: ${store.path}\n`);
    process.stdout.write(`${stringifyToml(toRecord(next))}\n`);
}
