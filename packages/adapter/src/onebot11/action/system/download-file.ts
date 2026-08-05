/**
 * download_file 动作：下载文件到缓存目录（P2-12）
 *
 * url → fetch 下载 → 存 deps.system.cacheDir（缺省抛错）→ 返回 { file }。
 * 文件名：download-<timestamp>-<basename>（headers 等扩展字段忽略）。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const downloadFileSchema = z.object({
    url: z.string(),
    thread_count: z.number().optional(),
    headers: z.record(z.string(), z.string()).optional(),
});

type DownloadFilePayload = z.infer<typeof downloadFileSchema>;

/** download_file 依赖（cacheDir 由装配方注入）。 */
export interface DownloadFileDeps {
    cacheDir?: string;
}

/** 下载文件到缓存目录（P2-12）。 */
export class DownloadFileAction extends BaseAction<DownloadFilePayload, { file: string }> {
    readonly name = "download_file";
    readonly schema = downloadFileSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: DownloadFileDeps;

    constructor(deps: DownloadFileDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: DownloadFilePayload): Promise<{ file: string }> {
        const { cacheDir } = this.deps;
        if (cacheDir === undefined || cacheDir === "") {
            throw new Error("download_file 未配置缓存目录（装配方未注入）");
        }
        const safeName = basename(new URL(payload.url).pathname) || "download.bin";
        const filePath = join(cacheDir, `download-${Date.now()}-${safeName}`);
        mkdirSync(cacheDir, { recursive: true });
        const init: RequestInit = {};
        if (payload.headers !== undefined) {
            init.headers = payload.headers;
        }
        const res = await fetch(payload.url, init);
        if (!res.ok) {
            throw new Error(`下载失败: ${res.status} ${res.statusText}`);
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        writeFileSync(filePath, buf);
        return { file: filePath };
    }
}
