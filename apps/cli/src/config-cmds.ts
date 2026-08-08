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
 *   [satori]                   # 协议段，与 satoriConfigSchema 对应
 *   token = ""
 *   [[satori.httpServers]]     # HTTP RPC 服务器
 *   enabled = false
 *   port = 5500
 *   [[satori.wsServers]]       # WS 事件服务（/v1/events）
 *   enabled = true
 *   port = 5501
 *
 * 配置文件路径解析见 kernel `resolveConfigPath`（NAPKETTO_CONFIG 显式 > 项目根探测 > cwd > 数据根兜底）；
 * 校验器为手写 parse（适配 kernel ConfigBase 的 ConfigSchema 形状）；
 * 协议段由对应协议包的 zod schema 校验（boot.cjs 装配时经 seed 传入）。
 */
import type { Dirent } from "node:fs";
import { mkdirSync, readdirSync } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
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
import { type CliConfig, parseCliConfig } from "./config-parse.js";
import { configTemplate } from "./config-template.js";
import { logger } from "./logger.js";

/** 主配置默认值（dataRoot 为当前解析的数据根）。 */
function defaultCliConfig(dataRoot: string): CliConfig {
    return {
        dataDir: dataRoot,
        autoRestart: true,
        restartDelayMs: 2000,
        accounts: [],
        onebot11: {},
        satori: {},
    };
}

/** 配置文件缺失 → 生成带注释模板（首次启动自动生成默认配置）。 */
async function ensureConfigTemplate(path: string, dataRoot: string): Promise<void> {
    try {
        await access(path);
    } catch {
        mkdirSync(dirname(path), { recursive: true });
        await writeFile(path, `${configTemplate(dataRoot)}\n`, "utf8");
        logger.info({ path }, "配置文件不存在，已生成默认模板（带注释，可参考修改）");
    }
}

/** 主配置 store（读/写/校验；.toml 后缀 → smol-toml 序列化）。
 * 配置文件在项目根（resolveConfigPath），dataRoot 仅作兜底与 dataDir 默认值。 */
class CliConfigStore extends ConfigBase<CliConfig> {
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
    await ensureConfigTemplate(store.path, dataRoot);
    return await store.load();
}

/** CliConfig → 普通对象（smol-toml stringify 入参）。 */
function toRecord(config: CliConfig): Record<string, unknown> {
    return config as unknown as Record<string, unknown>;
}

/** config init：生成全局 TOML 配置文件（项目根）+ 数据根目录。
 * 文件不存在 → 写带注释模板；已存在 → 跳过（不覆盖用户配置）。 */
export async function cmdConfigInit(opts: { dataDir?: string }): Promise<void> {
    const dataRoot = resolveDataRoot(opts.dataDir);
    mkdirSync(dataRoot, { recursive: true });
    const store = new CliConfigStore(dataRoot);
    let created = false;
    try {
        await access(store.path);
    } catch {
        mkdirSync(dirname(store.path), { recursive: true });
        await writeFile(store.path, `${configTemplate(dataRoot)}\n`, "utf8");
        created = true;
    }
    const config = await store.load();
    logger.info({ dataRoot }, "数据根");
    if (created) {
        logger.info({ path: store.path }, "全局配置已生成（默认模板，带注释）");
    } else {
        logger.info({ path: store.path }, "全局配置已存在（跳过生成，避免覆盖用户配置）");
    }
    // TOML 内容为功能输出（机器可读），保持原样 stdout，不做日志包装
    process.stdout.write(`${stringifyToml(toRecord(config))}\n`);
}

/** config list：列出全局配置与各账号目录。 */
export async function cmdConfigList(opts: { dataDir?: string }): Promise<void> {
    const dataRoot = resolveDataRoot(opts.dataDir);
    const store = new CliConfigStore(dataRoot);
    const config = await store.load();
    logger.info({ dataRoot }, "数据根");
    logger.info({ path: store.path }, "全局配置");
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
function printAccountConfig(account: string, dataRoot: string): void {
    const configDir = join(dataRoot, account, "config");
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
    // 注意：字段名用 account 而非 name——name 是 pino 保留键（logger name），
    // 会被 pino-pretty 渲染成 `(name/pid)` 元数据头而非普通字段。
    logger.info({ account, files: fileList }, "账号配置");
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
    logger.info({ path: store.path }, "全局配置已更新");
    // TOML 内容为功能输出（机器可读），保持原样 stdout，不做日志包装
    process.stdout.write(`${stringifyToml(toRecord(next))}\n`);
}
