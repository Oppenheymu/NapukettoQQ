/**
 * JSON 配置基类（ADR-012）
 *
 * 读文件 → 校验 → 内存对象 → 变更写回。
 *
 * kernel 不依赖 zod：只依赖校验器的最小 `parse` 形状（`ConfigSchema`），
 * 协议包的 zod schema 天然满足；kernel 主配置用手写校验器包装。
 * 协议配置 schema 在各自协议包，见各包 docs/design.md。
 */
import { mkdirSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { KernelError } from "./errors.js";

function isMissingFileError(err: unknown): boolean {
    if (err instanceof Error) {
        return (err as NodeJS.ErrnoException).code === "ENOENT";
    }
    return false;
}

/**
 * 校验器最小接口。zod 的 `ZodType<T>`（`parse(data: unknown): T`）天然满足；
 * 手写校验器包装成该形状即可。
 */
export interface ConfigSchema<T> {
    parse: (input: unknown) => T;
}

export interface ConfigOptions<T> {
    /** 配置文件绝对路径。 */
    path: string;
    /** 校验器（协议 schema 用 zod；kernel 主配置用手写校验器包装）。 */
    schema: ConfigSchema<T>;
    /** 默认值：文件缺失时生成并落盘；校验以它为兜底。 */
    defaults: T;
}

/**
 * JSON 配置基类。每次 `load()` / `save()` 都经过 schema 校验，
 * 校验失败抛 `KernelError('INVALID_PARAM')`，不静默吞掉。
 */
export class ConfigBase<T> {
    readonly path: string;
    readonly defaults: T;

    private readonly schema: ConfigSchema<T>;
    private value: T;

    constructor(opts: ConfigOptions<T>) {
        this.path = opts.path;
        this.defaults = opts.defaults;
        this.schema = opts.schema;
        this.value = opts.defaults;
    }

    /** 当前内存值（只读消费；外部不得直接修改返回对象）。 */
    get(): T {
        return this.value;
    }

    /**
     * 加载配置：
     * - 文件缺失 → 写入默认值并落盘（首次运行自动生成），返回默认值；
     * - 文件存在 → 读取 + 校验，更新内存，返回。
     */
    async load(): Promise<T> {
        let raw: string;
        try {
            raw = await readFile(this.path, "utf8");
        } catch (err) {
            if (isMissingFileError(err)) {
                await this.save(this.defaults);
                return this.value;
            }
            throw new KernelError(`读取配置文件失败: ${this.path}`, "UNKNOWN", { cause: err });
        }
        this.value = this.parse(raw);
        return this.value;
    }

    /** 重新从磁盘加载（外部变更后的热更新入口，P2 配置热更新使用）。 */
    reload(): Promise<T> {
        return this.load();
    }

    /** 校验并落盘（原子写：临时文件 + rename），随后更新内存。 */
    async save(next: T): Promise<void> {
        const parsed = this.parse(JSON.stringify(next));
        mkdirSync(dirname(this.path), { recursive: true });
        const tmpPath = `${this.path}.tmp`;
        await writeFile(tmpPath, `${JSON.stringify(parsed, null, 4)}\n`, "utf8");
        await rename(tmpPath, this.path);
        this.value = parsed;
    }

    /** 反序列化 + schema 校验，错误统一包装为 KernelError。 */
    private parse(raw: string): T {
        let input: unknown;
        try {
            input = JSON.parse(raw) as unknown;
        } catch (err) {
            throw new KernelError(`配置文件 JSON 解析失败: ${this.path}`, "INVALID_PARAM", {
                cause: err,
            });
        }
        try {
            return this.schema.parse(input);
        } catch (err) {
            throw new KernelError(`配置文件校验失败: ${this.path}`, "INVALID_PARAM", {
                cause: err,
            });
        }
    }
}
