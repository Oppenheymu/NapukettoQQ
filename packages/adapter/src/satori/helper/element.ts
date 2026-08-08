/**
 * Satori 消息元素解析/渲染（协议 v1，自研实现，规范参考 satori.chat/zh-CN/protocol/message.html）
 *
 * - parseElements：XML 风格字符串 → 元素树（注释/转义/无值属性/未配对标签容错）
 * - renderElements：元素树 → 字符串（消息 content 序列化）
 * - canonical ↔ Satori 双向转换见 element-convert.ts（本文件尾部 re-export）
 *
 * 语法要点（对齐规范）：
 * - 转义：&quot; &amp; &lt; &gt; &#39; &#x27; 与十进制/十六进制数字实体
 * - 注释 <!-- --> 不渲染
 * - 无值属性（key）与 key="value" / key='value' 均合法
 * - 未配对的标签视为文本内容的一部分
 * - 文本内容前后包含换行符的连续空白会被忽略
 */
import { readTag, readTagName } from "./parse-tag.js";

/** Satori 消息元素（与规范 satori-parse 形状一致；type="text" 为文本节点）。 */
export interface SatoriElement {
    type: string;
    attrs?: Record<string, string>;
    children?: SatoriElement[];
    text?: string;
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

/** Satori 消息解析器状态（挂载点 / 文本缓冲 / 栈管理，拆分主循环复杂度）。 */
class ElementParser {
    private readonly root: SatoriElement[] = [];
    private readonly stack: SatoriElement[] = [];
    private text = "";

    /** 当前挂载数组（栈顶元素 children 或根数组）。 */
    private mountPoint(): SatoriElement[] {
        const top = this.stack[this.stack.length - 1];
        if (top === undefined) {
            return this.root;
        }
        top.children ??= [];
        return top.children;
    }

    /** 归一化文本落位到当前挂载点。 */
    pushText(): void {
        const normalized = normalizeText(this.text);
        this.text = "";
        if (normalized !== "") {
            this.mountPoint().push({ type: "text", text: normalized });
        }
    }

    /** 解析完成的元素树。 */
    get elements(): SatoriElement[] {
        return this.root;
    }

    /** 追加原始文本（解析间隙累积）。 */
    appendRaw(raw: string): void {
        this.text += raw;
    }

    /** 起始/自闭合标签落位（压栈或仅挂载）。 */
    openTag(name: string, attrs: Record<string, string>, selfClosing: boolean): void {
        const el: SatoriElement = { type: name, attrs };
        this.mountPoint().push(el);
        if (!selfClosing) {
            this.stack.push(el);
        }
    }

    /** 收尾：剩余文本落位（栈剩余未闭合元素：文本落在栈顶元素内，宽容）。 */
    flush(): void {
        this.pushText();
    }

    /** 注释：返回跳过后的位置；-1 = 未闭合终止解析（注释不渲染）。 */
    skipComment(source: string, pos: number): number {
        const end = source.indexOf("-->", pos);
        return end === -1 ? -1 : end + 3;
    }

    /**
     * 结束标签：匹配栈顶则闭合，否则按文本保留。
     * @returns 下一个解析位置；-1 = 终止解析。
     */
    closeTag(source: string, lt: number, slashPos: number): number {
        const { name, end } = readTagName(source, slashPos + 1);
        if (name === "") {
            // 非法结束标签（</> 等）：< 按文本保留
            this.text += "<";
            return lt + 1;
        }
        const gt = source.indexOf(">", end);
        if (gt === -1) {
            this.text += source.slice(lt);
            return -1;
        }
        const top = this.stack[this.stack.length - 1];
        if (top !== undefined && top.type === name) {
            // 闭合前的文本推入该元素
            this.pushText();
            this.stack.pop();
        } else {
            // 未配对：原样当文本
            this.text += source.slice(lt, gt + 1);
        }
        return gt + 1;
    }
}

/**
 * 解析 Satori 消息字符串 → 元素树。
 * 容错：未配对标签/非法标签按文本保留；解析不抛错（消息内容宽容）。
 */
export function parseElements(source: string): SatoriElement[] {
    const parser = new ElementParser();
    let i = 0;
    while (i < source.length) {
        const lt = source.indexOf("<", i);
        if (lt === -1) {
            parser.appendRaw(source.slice(i));
            break;
        }
        parser.appendRaw(source.slice(i, lt));
        i = lt + 1;
        // 注释：不渲染
        if (source.startsWith("!--", i)) {
            const next = parser.skipComment(source, i);
            if (next === -1) {
                break;
            }
            i = next;
            continue;
        }
        // 结束标签
        if (source.startsWith("/", i)) {
            const next = parser.closeTag(source, lt, i);
            if (next === -1) {
                break;
            }
            i = next;
            continue;
        }
        // 起始 / 自闭合标签
        const tag = readTag(source, i);
        if (tag.name === "") {
            parser.appendRaw("<");
            continue;
        }
        parser.pushText();
        parser.openTag(tag.name, tag.attrs, tag.selfClosing);
        i = tag.end;
    }
    parser.flush();
    return parser.elements;
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

/** canonical ↔ Satori 双向转换（收方向 canonical.ts / 发方向 element-convert.ts）。 */
export type { CanonicalToSatoriDeps } from "./canonical.js";
export { canonicalToSatoriElements } from "./canonical.js";
export type { SatoriToCanonicalDeps } from "./element-convert.js";
export {
    parseContentToCanonical,
    satoriToCanonicalElements,
} from "./element-convert.js";
