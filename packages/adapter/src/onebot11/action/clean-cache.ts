/**
 * clean_cache 动作：清理缓存（本地组装，P2-11）
 *
 * cleanCache 回调由装配方注入（boot.cjs 接 kernel PathWrapper.clearCache）。
 * 未配置时明确报错（不静默）。
 */

import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const cleanCacheSchema = z.object({});

type CleanCachePayload = z.infer<typeof cleanCacheSchema>;

/** clean_cache 依赖（cleanCache 回调由装配方注入）。 */
export interface CleanCacheDeps {
    cleanCache?: () => Promise<void>;
}

/** 清理缓存（P2-11）。 */
export class CleanCacheAction extends BaseAction<CleanCachePayload, null> {
    readonly name = "clean_cache";
    readonly schema = cleanCacheSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: CleanCacheDeps;

    constructor(deps: CleanCacheDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(_payload: CleanCachePayload): Promise<null> {
        if (this.deps.cleanCache === undefined) {
            throw new Error("clean_cache 未配置（装配方未注入清理回调）");
        }
        await this.deps.cleanCache();
        return null;
    }
}
