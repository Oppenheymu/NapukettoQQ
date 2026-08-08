/**
 * 发方向转换：Satori 元素 → kernel canonical（从 element.ts 拆分，2026-08-08 FTA 优化）
 *
 * - satoriToCanonicalElements：Satori 元素树 → kernel canonical（at uin→uid + 资源下载/转码）
 * - parseContentToCanonical：消息 content 字符串 → canonical（message.create 用）
 *
 * 收方向（canonical → Satori）在 canonical.ts；解析/渲染（parseElements / renderElements）
 * 留在 element.ts；资源处理（http 下载 / silk 转码 / internal 路径）在 asset.ts。
 * 本文件只做发方向元素映射。
 */
import type { CanonicalElement } from "@napuketto/kernel";
import { ensureSilk, resolveAsset } from "./asset.js";
import type { SatoriElement } from "./element.js";
import { parseElements } from "./element.js";

/** 发方向依赖（at uin 转换 + 资源下载目录）。 */
export interface SatoriToCanonicalDeps {
    /** uin → uid（at 目标转换）。 */
    uinToUid: (uins: string[]) => Promise<Map<string, string>>;
    /** 资源（img/audio/video/file）下载缓存目录。 */
    cacheDir: string;
}

/** 发方向：Satori 元素树 → kernel canonical（at uin→uid + 资源下载/转码）。 */
export async function satoriToCanonicalElements(
    elements: SatoriElement[],
    deps: SatoriToCanonicalDeps,
): Promise<CanonicalElement[]> {
    // 预收集 at uin → 批量转换
    const atUins: string[] = [];
    const collectAt = (list: SatoriElement[]): void => {
        for (const el of list) {
            const id = el.attrs?.["id"];
            if (el.type === "at" && id !== undefined && id !== "all") {
                atUins.push(id);
            }
            if (el.children !== undefined) {
                collectAt(el.children);
            }
        }
    };
    collectAt(elements);
    let uinToUidMap = new Map<string, string>();
    if (atUins.length > 0) {
        try {
            uinToUidMap = await deps.uinToUid([...new Set(atUins)]);
        } catch {
            // uin 解析失败：at 原样（uin），由 kernel 发送时兜底
        }
    }
    const out: CanonicalElement[] = [];
    for (const el of elements) {
        out.push(...(await elementToCanonical(el, deps, uinToUidMap)));
    }
    return out;
}

/** 解析元素媒体 src（空 → null 忽略），返回本地路径。 */
async function resolveMediaSrc(
    el: SatoriElement,
    deps: SatoriToCanonicalDeps,
): Promise<string | null> {
    const src = el.attrs?.["src"] ?? "";
    if (src === "") {
        return null;
    }
    return resolveAsset(src, deps.cacheDir);
}

/** Satori at → canonical at（uin → uid，name → display）。 */
function atToCanonical(el: SatoriElement, uinToUidMap: Map<string, string>): CanonicalElement[] {
    const id = el.attrs?.["id"] ?? "";
    if (id === "all") {
        return [{ type: "at", target: "all" }];
    }
    if (id === "") {
        return [];
    }
    const target = uinToUidMap.get(id) ?? id;
    const display = el.attrs?.["name"];
    const base: CanonicalElement = { type: "at", target };
    if (display !== undefined && display !== "") {
        return [{ ...base, display }];
    }
    return [base];
}

/** Satori img → canonical image。 */
async function imgToCanonical(
    el: SatoriElement,
    deps: SatoriToCanonicalDeps,
): Promise<CanonicalElement[]> {
    const path = await resolveMediaSrc(el, deps);
    return path === null ? [] : [{ type: "image", path }];
}

/** Satori audio → canonical voice（非 silk 转码）。 */
async function audioToCanonical(
    el: SatoriElement,
    deps: SatoriToCanonicalDeps,
): Promise<CanonicalElement[]> {
    const path = await resolveMediaSrc(el, deps);
    return path === null ? [] : [{ type: "voice", path: await ensureSilk(path) }];
}

/** Satori video → canonical video。 */
async function videoToCanonical(
    el: SatoriElement,
    deps: SatoriToCanonicalDeps,
): Promise<CanonicalElement[]> {
    const path = await resolveMediaSrc(el, deps);
    return path === null ? [] : [{ type: "video", path }];
}

/** Satori file → canonical file（title → name）。 */
async function fileToCanonical(
    el: SatoriElement,
    deps: SatoriToCanonicalDeps,
): Promise<CanonicalElement[]> {
    const path = await resolveMediaSrc(el, deps);
    if (path === null) {
        return [];
    }
    const title = el.attrs?.["title"];
    const base: CanonicalElement = { type: "file", path };
    if (title !== undefined && title !== "") {
        return [{ ...base, name: title }];
    }
    return [base];
}

/** Satori message：forward 属性 → canonical forward；否则展开子元素。 */
async function messageToCanonical(
    el: SatoriElement,
    deps: SatoriToCanonicalDeps,
    uinToUidMap: Map<string, string>,
): Promise<CanonicalElement[]> {
    if (el.attrs?.["forward"] !== undefined) {
        const id = el.attrs?.["id"] ?? "";
        return id === "" ? [] : [{ type: "forward", messageIds: [id] }];
    }
    // 普通 message 元素：展开子元素
    return flattenChildren(el.children, deps, uinToUidMap);
}

/** 单个元素 → canonical（递归；修饰/排版元素展开子元素）。 */
async function elementToCanonical(
    el: SatoriElement,
    deps: SatoriToCanonicalDeps,
    uinToUidMap: Map<string, string>,
): Promise<CanonicalElement[]> {
    switch (el.type) {
        case "text": {
            const text = el.text ?? "";
            return text === "" ? [] : [{ type: "text", text }];
        }
        case "at":
            return atToCanonical(el, uinToUidMap);
        case "img":
            return imgToCanonical(el, deps);
        case "audio":
            return audioToCanonical(el, deps);
        case "video":
            return videoToCanonical(el, deps);
        case "file":
            return fileToCanonical(el, deps);
        case "emoji": {
            const id = el.attrs?.["id"] ?? "";
            return id === "" ? [] : [{ type: "face", id }];
        }
        case "quote": {
            const id = el.attrs?.["id"] ?? "";
            return id === "" ? [] : [{ type: "reply", messageId: id }];
        }
        case "message":
            return messageToCanonical(el, deps, uinToUidMap);
        case "br":
            return [{ type: "text", text: "\n" }];
        case "author":
        case "sharp":
        case "a":
        case "button":
            // QQ 不支持：忽略（button 交互第一版不做）
            return [];
        default:
            // 修饰（b/i/u/s/code 等）/排版（p）元素：展开子元素
            return flattenChildren(el.children, deps, uinToUidMap);
    }
}

/** 展开子元素为 canonical（递归）。 */
async function flattenChildren(
    children: SatoriElement[] | undefined,
    deps: SatoriToCanonicalDeps,
    uinToUidMap: Map<string, string>,
): Promise<CanonicalElement[]> {
    const out: CanonicalElement[] = [];
    for (const child of children ?? []) {
        out.push(...(await elementToCanonical(child, deps, uinToUidMap)));
    }
    return out;
}

/** 解析消息 content 字符串 → canonical（message.create 用）。 */
export async function parseContentToCanonical(
    content: string,
    deps: SatoriToCanonicalDeps,
): Promise<CanonicalElement[]> {
    const elements = parseElements(content);
    return satoriToCanonicalElements(elements, deps);
}
