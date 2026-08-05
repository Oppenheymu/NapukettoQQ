/**
 * 数据目录布局（ADR-016）
 *
 * ```
 * <用户数据根>/<qq号>/          # 每账号独立目录（ADR-015 多账号前提）
 * ├── config/                   # napuketto.json + onebot11.json 等
 * ├── logs/                     # pino 文件日志
 * └── cache/                    # 临时文件、媒体缓存
 * ```
 *
 * 数据根优先级：cli `--data-dir`（显式参数）> `NAPKETTO_DATA` 环境变量 > `~/.napuketto`（默认）。
 */
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

/** 默认数据根目录名（用户目录下，程序目录可能只读，见 ADR-016）。 */
export const DEFAULT_DATA_ROOT_NAME = ".napuketto";

export interface PathOptions {
    /** 显式数据根（cli `--data-dir` 传入，优先级最高）。 */
    dataRoot?: string;
    /** QQ 号，用于多账号隔离；缺省时直接使用数据根本身。 */
    account?: string;
}

/**
 * 解析数据根：显式参数 > 环境变量 > 用户目录默认。
 * 返回绝对路径。独立导出便于 cli / 探测脚本复用。
 */
export function resolveDataRoot(dataRoot?: string): string {
    const explicit = dataRoot ?? process.env["NAPKETTO_DATA"];
    if (explicit) {
        return resolve(explicit);
    }
    return join(homedir(), DEFAULT_DATA_ROOT_NAME);
}

/**
 * 路径装配器：持有账号数据目录下的全部子目录。
 * 无全局单例（ADR-015 推论）——每账号每进程实例化一份。
 */
export class PathWrapper {
    /** 数据根（绝对路径）。 */
    readonly root: string;
    /** 账号数据目录（绝对路径），缺省 account 时等于 root。 */
    readonly accountDir: string;
    /** config 目录（napuketto.json + 各协议配置）。 */
    readonly configDir: string;
    /** logs 目录（pino 文件日志）。 */
    readonly logsDir: string;
    /** cache 目录（临时文件、媒体缓存）。 */
    readonly cacheDir: string;

    constructor(opts: PathOptions = {}) {
        const root = resolveDataRoot(opts.dataRoot);
        this.root = root;
        if (opts.account) {
            this.accountDir = join(root, opts.account);
        } else {
            this.accountDir = root;
        }
        this.configDir = join(this.accountDir, "config");
        this.logsDir = join(this.accountDir, "logs");
        this.cacheDir = join(this.accountDir, "cache");
    }

    /** 递归创建全部目录，启动装配时调用一次。 */
    ensure(): void {
        for (const dir of [this.configDir, this.logsDir, this.cacheDir]) {
            mkdirSync(dir, { recursive: true });
        }
    }

    /** 账号目录内的文件路径（如 `file('config', 'napuketto.json')`）。 */
    file(...segments: string[]): string {
        return join(this.accountDir, ...segments);
    }

    /**
     * 清空缓存目录（clean_cache 动作经注入回调消费）。
     * 只删除 cacheDir 下的条目，保留目录本身。
     */
    clearCache(): void {
        let entries: string[];
        try {
            entries = readdirSync(this.cacheDir);
        } catch {
            return; // 目录不存在视为空
        }
        for (const entry of entries) {
            rmSync(join(this.cacheDir, entry), { recursive: true, force: true });
        }
    }
}
