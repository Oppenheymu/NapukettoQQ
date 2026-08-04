/**
 * 协议配置加载基类：复用 kernel ConfigBase（zod schema 天然满足其校验器接口）。
 */
import { ConfigBase } from "@napuketto/kernel";
import type { ZodType } from "zod";

/** 协议配置基类：zod schema + JSON 读写（文件路径由装配层传入）。 */
export class ProtocolConfig<T> extends ConfigBase<T> {
    constructor(opts: { path: string; schema: ZodType<T>; defaults: T }) {
        super({ path: opts.path, schema: opts.schema, defaults: opts.defaults });
    }
}
