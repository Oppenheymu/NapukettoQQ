/**
 * qq-releases.ts：版本清单读取（P1）。
 *
 * 运行时从包根 qq-releases.json 读取（发布时 files 含它，安装后位于
 * node_modules/@napuketto/loader/qq-releases.json）。清单由 CI/社区 PR 维护
 * （设计文档 §2.2）。NAPUTO_QQ_URL 可运行时覆盖下载地址。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** 清单中单个版本条目。 */
export interface QqReleaseEntry {
    /** 版本目录名（如 9.9.33-51802）。 */
    version: string;
    /** 官方安装包下载 URL。 */
    url: string;
    /** sha256（十六进制小写）；空串 = 尚未校验（首次录入时 CI 计算后填入）。 */
    sha256: string;
    /** appid（预知信息，运行时仍从 major.node 解析）。 */
    appid: number;
    /** 来源标记（official = 官方）。 */
    source: string;
    /** 构建日期（YYYY-MM-DD，可选）。 */
    buildDate?: string;
}

/** 清单文件结构。 */
export interface QqReleasesFile {
    schema: number;
    known: QqReleaseEntry[];
}

/** 清单解析失败。 */
export class QqReleasesError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "QqReleasesError";
    }
}

/** 包根路径（dist 与包根同层：dist/index.mjs → ../qq-releases.json）。 */
function packageRoot(): string {
    return dirname(dirname(fileURLToPath(import.meta.url)));
}

/** 读版本清单（同步，启动期调用一次即可）。 */
export function loadQqReleases(): QqReleasesFile {
    const file = join(packageRoot(), "qq-releases.json");
    let raw: string;
    try {
        raw = readFileSync(file, "utf8");
    } catch {
        throw new QqReleasesError(`版本清单缺失: ${file}（@napuketto/loader 包安装不完整？）`);
    }
    try {
        const parsed = JSON.parse(raw) as Partial<QqReleasesFile>;
        if (parsed.schema !== 1 || !Array.isArray(parsed.known) || parsed.known.length === 0) {
            throw new Error("结构不合法");
        }
        return parsed as QqReleasesFile;
    } catch {
        throw new QqReleasesError(`版本清单解析失败: ${file}`);
    }
}

/** 取最新已知可用版本（known 数组按录入顺序，取最后一项 = 最新）。 */
export function latestRelease(releases: QqReleasesFile): QqReleaseEntry {
    const [latest] = [...releases.known].reverse();
    if (latest === undefined) {
        throw new QqReleasesError("版本清单为空");
    }
    return latest;
}

/**
 * 解析实际下载 URL：NAPUTO_QQ_URL 环境变量覆盖 > 清单 URL。
 * 供 downloadFile 使用（也支持按版本查询，当前固定取最新）。
 */
export function resolveDownloadUrl(release: QqReleaseEntry): string {
    const override = process.env["NAPUTO_QQ_URL"];
    return override !== undefined && override !== "" ? override : release.url;
}
