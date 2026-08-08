/**
 * 发方向转换依赖契约（Satori 元素 → kernel canonical）
 *
 * 2026-08-08 从 element-convert.ts 独立：media-convert.ts（媒体转换器）同样
 * 消费该类型，独立成文件后消除 element-convert ↔ media-convert 的循环引用
 * （madge 检测的 type-only 环）。
 */

/** 发方向依赖（at uin 转换 + 资源下载目录）。 */
export interface SatoriToCanonicalDeps {
    /** uin → uid（at 目标转换）。 */
    uinToUid: (uins: string[]) => Promise<Map<string, string>>;
    /** 资源（img/audio/video/file）下载缓存目录。 */
    cacheDir: string;
}
