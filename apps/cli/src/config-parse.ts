/**
 * 主配置类型与手写校验器（从 config-cmds.ts 拆分，2026-08-08 FTA 优化）
 *
 * 主配置 parse（不引入 zod）：数据根 / 自动重启 / 重启延迟 / 账号列表 /
 * onebot11 段 / satori 段。协议段为宽松对象，装配时由对应协议包的 zod schema 严格校验。
 */
import { kernelError, resolveDataRoot } from "@napuketto/kernel";

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
    /** satori 协议段（与 satoriConfigSchema 对应，宽松对象，装配时 zod 校验）。 */
    satori?: Record<string, unknown>;
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

/** 解析 satori 段（宽松对象，装配时由 zod schema 严格校验）。 */
function parseSatori(raw: Record<string, unknown>): Record<string, unknown> | undefined {
    if (raw["satori"] === undefined) {
        return;
    }
    if (typeof raw["satori"] !== "object" || raw["satori"] === null) {
        throw kernelError("主配置 satori 段必须是对象", "INVALID_PARAM");
    }
    return raw["satori"] as Record<string, unknown>;
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

/** 手写校验器：主配置 parse（不引入 zod）。 */
export function parseCliConfig(input: unknown): CliConfig {
    if (typeof input !== "object" || input === null) {
        throw kernelError("主配置必须是对象", "INVALID_PARAM");
    }
    const raw = input as Record<string, unknown>;
    const dataDir = parseDataDir(raw);
    const autoRestart = parseAutoRestart(raw);
    const restartDelayMs = parseRestartDelayMs(raw);
    const accounts = parseAccounts(raw);
    const onebot11 = parseOnebot11(raw);
    const satori = parseSatori(raw);
    const out: CliConfig = { dataDir, autoRestart, restartDelayMs, accounts };
    if (onebot11 !== undefined) {
        out.onebot11 = onebot11;
    }
    if (satori !== undefined) {
        out.satori = satori;
    }
    return out;
}
