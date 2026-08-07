/**
 * Satori 消息元素编码/解码（协议 v1，自研实现，规范参考 satori.chat/zh-CN/protocol/message.html）
 *
 * - parseElements：XML 风格字符串 → 元素树（注释/转义/无值属性/未配对标签容错）
 * - renderElements：元素树 → 字符串（消息 content 序列化）
 * - canonicalToSatoriElements：kernel canonical → Satori 元素（收方向）
 * - satoriToCanonicalElements：Satori 元素 → kernel canonical（发方向，含资源下载/转码）
 *
 * 语法要点（对齐规范）：
 * - 转义：&quot; &amp; &lt; &gt; &#39; &#x27; 与十进制/十六进制数字实体
 * - 注释 <!-- --> 不渲染
 * - 无值属性（key）与 key="value" / key='value' 均合法
 * - 未配对的标签视为文本内容的一部分
 * - 文本内容前后包含换行符的连续空白会被忽略
 */
import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CanonicalElement } from "@napuketto/kernel";
import { kernelError } from "@napuketto/kernel";
import { encodePcmToSilk } from "@napuketto/media";

/** Satori 消息元素（与规范 satori-parse 形状一致；type="text" 为文本节点）。 */
export interface SatoriElement {
    type: string;
    attrs?: Record<string, string>;
    children?: SatoriElement[];
    text?: string;
}

/** 命名实体（规范规定的四个 + apos 宽容）。 */
const NAMED_ENTITIES: Record<string, string> = {
    quot: '"',
    amp: "&",
    lt: "<",
    gt: ">",
    apos: "'",
};

/** 解码单个实体（命名/十进制/十六进制）。 */
function decodeEntity(body: string): string {
    const named = NAMED_ENTITIES[body];
    if (named !== undefined) {
        return named;
    }
    if (body.startsWith("#x") || body.startsWith("#X")) {
        const code = Number.parseInt(body.slice(2), 16);
        if (Number.isInteger(code)) {
            return String.fromCodePoint(code);
        }
    }
    if (body.startsWith("#")) {
        const code = Number.parseInt(body.slice(1), 10);
        if (Number.isInteger(code)) {
            return String.fromCodePoint(code);
        }
    }
    // 未识别实体原样保留
    return `&${body};`;
}

/** 解码字符串中的全部实体。 */
function decodeEntities(input: string): string {
    return input.replace(/&([^;]+);/g, (_full, body: string) => decodeEntity(body));
}

/** 文本转义（& < >）。 */
function encodeText(input: string): string {
    return input.replace(/[&<>]/g, (ch) => {
        if (ch === "&") {
            return "&amp;";
        }
        if (ch === "<") {
            return "&lt;";
        }
        return "&gt;";
    });
}

/** 属性值转义（& " < >）。 */
function encodeAttr(input: string): string {
    return input.replace(/[&"<>]/g, (ch) => {
        if (ch === "&") {
            return "&amp;";
        }
        if (ch === '"') {
            return "&quot;";
        }
        if (ch === "<") {
            return "&lt;";
        }
        return "&gt;";
    });
}

/** 元素名：小写字母/数字/连字符，以字母开头（规范）。 */
const NAME_RE = /^[a-z][a-z0-9-]*/i;

/** 读取元素名（pos 起）；未匹配返回空名。 */
function readTagName(source: string, pos: number): { name: string; end: number } {
    const rest = source.slice(pos);
    const m = NAME_RE.exec(rest);
    if (m === null) {
        return { name: "", end: pos };
    }
    return { name: m[0], end: pos + m[0].length };
}

/** 读取完整标签（元素名 + 属性 + 闭合指示），返回属性表与结束位置。 */
function readTag(
    source: string,
    pos: number,
): { name: string; attrs: Record<string, string>; selfClosing: boolean; end: number } {
    const { name, end } = readTagName(source, pos);
    if (name === "") {
        return { name: "", attrs: {}, selfClosing: false, end: pos };
    }
    let i = end;
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    while (i < source.length) {
        const ch = source.charAt(i);
        if (ch === ">") {
            i += 1;
            break;
        }
        if (ch === "/") {
            if (source.charAt(i + 1) === ">") {
                selfClosing = true;
                i += 2;
                break;
            }
            i += 1;
            continue;
        }
        if (/\s/.test(ch)) {
            i += 1;
            continue;
        }
        // 属性名（字母数字 / 冒号（命名空间）/ 连字符 / 下划线）
        const keyMatch = /^[a-zA-Z0-9:_-]+/.exec(source.slice(i));
        if (keyMatch === null) {
            i += 1;
            continue;
        }
        const key = keyMatch[0];
        i += key.length;
        // 跳过等号前空白
        while (i < source.length && /\s/.test(source.charAt(i))) {
            i += 1;
        }
        if (source.charAt(i) === "=") {
            i += 1;
            while (i < source.length && /\s/.test(source.charAt(i))) {
                i += 1;
            }
            const quote = source.charAt(i);
            if (quote === '"' || quote === "'") {
                i += 1;
                const valueStart = i;
                while (i < source.length && source.charAt(i) !== quote) {
                    i += 1;
                }
                const value = source.slice(valueStart, i);
                if (i < source.length) {
                    i += 1; // 跳过结束引号
                }
                attrs[key] = decodeEntities(value);
            } else {
                // 无引号值（到空白或 > 为止）
                const valueStart = i;
                while (i < source.length && !/[\s>]/.test(source.charAt(i))) {
                    i += 1;
                }
                attrs[key] = decodeEntities(source.slice(valueStart, i));
            }
        } else {
            // 无值属性
            attrs[key] = "";
        }
    }
    return { name, attrs, selfClosing, end: i };
}

/**
 * 文本规范化：开头/结尾的「包含换行符的连续空白」被忽略（规范），
 * 中间的空白与不含换行的首尾空白保留。
 */
function normalizeText(raw: string): string {
    const leading = /^\s+/.exec(raw);
    const trailing = /\s+$/.exec(raw);
    let out = raw;
    if (leading !== null && /[\r\n]/.test(leading[0])) {
        out = out.slice(leading[0].length);
    }
    if (trailing !== null && /[\r\n]/.test(trailing[0])) {
        out = out.slice(0, -trailing[0].length);
    }
    return out;
}

/**
 * 解析 Satori 消息字符串 → 元素树。
 * 容错：未配对标签/非法标签按文本保留；解析不抛错（消息内容宽容）。
 */
export function parseElements(source: string): SatoriElement[] {
    const root: SatoriElement[] = [];
    const stack: SatoriElement[] = [];
    let text = "";

    const pushText = (): void => {
        const normalized = normalizeText(text);
        text = "";
        if (normalized === "") {
            return;
        }
        const node: SatoriElement = { type: "text", text: normalized };
        const target = stack.length > 0 ? stack[stack.length - 1] : undefined;
        if (target !== undefined) {
            target.children ??= [];
            target.children.push(node);
        } else {
            root.push(node);
        }
    };

    const pushElement = (el: SatoriElement): void => {
        const target = stack.length > 0 ? stack[stack.length - 1] : undefined;
        if (target !== undefined) {
            target.children ??= [];
            target.children.push(el);
        } else {
            root.push(el);
        }
    };

    let i = 0;
    while (i < source.length) {
        const lt = source.indexOf("<", i);
        if (lt === -1) {
            text += source.slice(i);
            break;
        }
        text += source.slice(i, lt);
        i = lt + 1;

        // 注释：不渲染
        if (source.startsWith("!--", i)) {
            const end = source.indexOf("-->", i);
            if (end === -1) {
                break;
            }
            i = end + 3;
            continue;
        }
        // 结束标签
        if (source.startsWith("/", i)) {
            const { name, end } = readTagName(source, i + 1);
            if (name === "") {
                text += "<";
                continue;
            }
            const gt = source.indexOf(">", end);
            if (gt === -1) {
                text += source.slice(lt);
                break;
            }
            const top = stack.length > 0 ? stack[stack.length - 1] : undefined;
            if (top !== undefined && top.type === name) {
                // 闭合前的文本推入该元素
                pushText();
                stack.pop();
            } else {
                // 未配对：原样当文本
                text += source.slice(lt, gt + 1);
            }
            i = gt + 1;
            continue;
        }
        // 起始 / 自闭合标签
        const tag = readTag(source, i);
        if (tag.name === "") {
            text += "<";
            continue;
        }
        pushText();
        const el: SatoriElement = { type: tag.name, attrs: tag.attrs };
        pushElement(el);
        if (!tag.selfClosing) {
            stack.push(el);
        }
        i = tag.end;
    }
    // 收尾：剩余文本落位（栈剩余未闭合元素：文本落在栈顶元素内，宽容）
    pushText();
    return root;
}

/** 元素树 → Satori 消息字符串。 */
export function renderElements(elements: SatoriElement[]): string {
    let out = "";
    for (const el of elements) {
        if (el.type === "text") {
            out += encodeText(el.text ?? "");
            continue;
        }
        out += renderElement(el);
    }
    return out;
}

/** 渲染单个元素（含子元素递归）。 */
function renderElement(el: SatoriElement): string {
    let attrs = "";
    for (const [key, value] of Object.entries(el.attrs ?? {})) {
        if (value === "") {
            // 无值属性（forward 等布尔属性）
            attrs += ` ${key}`;
        } else {
            attrs += ` ${key}="${encodeAttr(value)}"`;
        }
    }
    const children = el.children ?? [];
    if (children.length === 0) {
        return `<${el.type}${attrs}/>`;
    }
    const inner = renderElements(children);
    return `<${el.type}${attrs}>${inner}</${el.type}>`;
}

/** 收方向依赖（at uid 解析）。 */
export interface CanonicalToSatoriDeps {
    /** uid → uin（at 目标显示用；未提供原样返回 uid）。 */
    uidToUin?: (uids: string[]) => Promise<Map<string, string>>;
}

/**
 * 收方向：kernel canonical 元素 → Satori 元素树（纯函数映射，宽容忽略 unknown）。
 * at 目标为 uid 时经 uidToUin 转换（异步）；无转换器时原样。
 */
export async function canonicalToSatoriElements(
    elements: CanonicalElement[],
    deps: CanonicalToSatoriDeps = {},
): Promise<SatoriElement[]> {
    // 收集 at uid → 批量 uidToUin
    const atUids: string[] = [];
    for (const el of elements) {
        if (el.type === "at" && el.target !== "all") {
            atUids.push(el.target);
        }
    }
    let uidToUinMap = new Map<string, string>();
    if (atUids.length > 0 && deps.uidToUin !== undefined) {
        try {
            uidToUinMap = await deps.uidToUin([...new Set(atUids)]);
        } catch {
            // uid 解析失败：at 原样（uid），不阻塞事件翻译
        }
    }
    const out: SatoriElement[] = [];
    for (const el of elements) {
        switch (el.type) {
            case "text": {
                if (el.text !== "") {
                    out.push({ type: "text", text: el.text });
                }
                break;
            }
            case "at": {
                if (el.target === "all") {
                    out.push({ type: "at", attrs: { id: "all" } });
                    break;
                }
                const attrs: Record<string, string> = {
                    id: uidToUinMap.get(el.target) ?? el.target,
                };
                if (el.display !== undefined && el.display !== "") {
                    attrs["name"] = el.display;
                }
                out.push({ type: "at", attrs });
                break;
            }
            case "image": {
                out.push({ type: "img", attrs: { src: el.url ?? el.path } });
                break;
            }
            case "face": {
                out.push({ type: "emoji", attrs: { id: el.id } });
                break;
            }
            case "voice": {
                out.push({ type: "audio", attrs: { src: el.path } });
                break;
            }
            case "video": {
                out.push({ type: "video", attrs: { src: el.url ?? el.path } });
                break;
            }
            case "file": {
                const attrs: Record<string, string> = { src: el.path };
                if (el.name !== undefined && el.name !== "") {
                    attrs["title"] = el.name;
                }
                out.push({ type: "file", attrs });
                break;
            }
            case "reply": {
                out.push({ type: "quote", attrs: { id: el.messageId } });
                break;
            }
            case "forward": {
                const first = el.messageIds[0];
                if (first !== undefined && first !== "") {
                    out.push({ type: "message", attrs: { forward: "", id: first } });
                }
                break;
            }
            case "json":
            case "xml":
            case "unknown":
                // 无法表达：忽略（宽容）
                break;
        }
    }
    return out;
}

/** 发方向依赖（at uin 转换 + 资源下载目录）。 */
export interface SatoriToCanonicalDeps {
    /** uin → uid（at 目标转换）。 */
    uinToUid: (uins: string[]) => Promise<Map<string, string>>;
    /** 资源（img/audio/video/file）下载缓存目录。 */
    cacheDir: string;
}

/**
 * 解析资源 src：
 * - internal:{platform}/{user.id}/{path} → 本地路径（第一版仅支持 _tmp 保留路径）
 * - http(s):// → 下载到 cacheDir
 * - 其他 → 视为本地路径原样返回
 */
async function resolveAsset(src: string, cacheDir: string): Promise<string> {
    if (src.startsWith("internal:")) {
        // internal:qq/{uin}/_tmp/{file} → 取 _tmp 之后的路径（cacheDir 下的缓存文件）
        const pathPart = src.slice("internal:".length);
        const slash1 = pathPart.indexOf("/");
        if (slash1 === -1) {
            return pathPart;
        }
        const slash2 = pathPart.indexOf("/", slash1 + 1);
        if (slash2 === -1) {
            return pathPart;
        }
        const rest = pathPart.slice(slash2 + 1);
        // 去掉 _tmp/ 前缀段，回落到 cacheDir
        const tmpIdx = rest.indexOf("_tmp/");
        return tmpIdx === -1 ? rest : rest.slice(tmpIdx + 5);
    }
    if (/^https?:\/\//i.test(src)) {
        return downloadAsset(src, cacheDir);
    }
    return src;
}

/** 下载 URL 资源到缓存目录（返回本地路径）。 */
async function downloadAsset(url: string, cacheDir: string): Promise<string> {
    await mkdir(cacheDir, { recursive: true });
    const res = await fetch(url);
    if (!res.ok) {
        throw kernelError(`下载资源失败: ${url}`, "SEND_FAILED");
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const rawName = url.split("/").pop() ?? `asset-${Date.now()}`;
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_") || `asset-${Date.now()}`;
    const filePath = join(cacheDir, safeName);
    await writeFile(filePath, buf);
    return filePath;
}

/** 语音转码：非 silk 输入（wav/pcm）转 silk（QQ 语音格式）。 */
async function ensureSilk(path: string): Promise<string> {
    try {
        const header = await readFileHead(path);
        if (header.startsWith("#!SILK")) {
            return path;
        }
        // wav/pcm → silk（转码失败原样返回，由 kernel 发送时兜底）
        return await encodePcmToSilk(path);
    } catch {
        return path;
    }
}

/** 读文件头 8 字节（判断格式）。 */
async function readFileHead(path: string): Promise<string> {
    const handle = await open(path, "r");
    try {
        const buf = Buffer.alloc(8);
        await handle.read(buf, 0, 8, 0);
        return buf.toString("utf8");
    } finally {
        await handle.close();
    }
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
        case "at": {
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
        case "img": {
            const src = el.attrs?.["src"] ?? "";
            if (src === "") {
                return [];
            }
            const path = await resolveAsset(src, deps.cacheDir);
            return [{ type: "image", path }];
        }
        case "audio": {
            const src = el.attrs?.["src"] ?? "";
            if (src === "") {
                return [];
            }
            const path = await resolveAsset(src, deps.cacheDir);
            return [{ type: "voice", path: await ensureSilk(path) }];
        }
        case "video": {
            const src = el.attrs?.["src"] ?? "";
            if (src === "") {
                return [];
            }
            const path = await resolveAsset(src, deps.cacheDir);
            return [{ type: "video", path }];
        }
        case "file": {
            const src = el.attrs?.["src"] ?? "";
            if (src === "") {
                return [];
            }
            const path = await resolveAsset(src, deps.cacheDir);
            const title = el.attrs?.["title"];
            const base: CanonicalElement = { type: "file", path };
            if (title !== undefined && title !== "") {
                return [{ ...base, name: title }];
            }
            return [base];
        }
        case "emoji": {
            const id = el.attrs?.["id"] ?? "";
            if (id === "") {
                return [];
            }
            return [{ type: "face", id }];
        }
        case "quote": {
            const id = el.attrs?.["id"] ?? "";
            if (id === "") {
                return [];
            }
            return [{ type: "reply", messageId: id }];
        }
        case "message": {
            if (el.attrs?.["forward"] !== undefined) {
                const id = el.attrs?.["id"] ?? "";
                if (id === "") {
                    return [];
                }
                return [{ type: "forward", messageIds: [id] }];
            }
            // 普通 message 元素：展开子元素
            return flattenChildren(el.children, deps, uinToUidMap);
        }
        case "br": {
            return [{ type: "text", text: "\n" }];
        }
        case "author":
        case "sharp":
        case "a":
        case "button": {
            // QQ 不支持：忽略（button 交互第一版不做）
            return [];
        }
        default: {
            // 修饰（b/i/u/s/code 等）/排版（p）元素：展开子元素
            return flattenChildren(el.children, deps, uinToUidMap);
        }
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
