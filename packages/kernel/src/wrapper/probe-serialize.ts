/**
 * 运行时反射探测的序列化工具（从 probe.ts 拆分，2026-08-08 FTA 优化）
 *
 * - serialize：深度受限序列化（BigInt 转字符串，Map/Set/Promise 展开，循环引用防护）
 * - tryShape：解析 service getter 返回形状
 * - shapeKeyGetters：探测 service 关键数据 getter 返回形状
 */

/** 序列化深度上限（循环引用/深层对象防护）。 */
const MAX_SERIALIZE_DEPTH = 4;
/** 数组序列化条数上限。 */
const MAX_ARRAY_ITEMS = 20;
/** 对象键序列化条数上限。 */
const MAX_OBJECT_KEYS = 50;

/** 序列化一个值（BigInt 转字符串，Map/Set/Promise 展开，循环引用防护）。 */
export function serialize(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "function") return `[function ${value.name ?? "anon"}]`;
    if (typeof value !== "object") return value;
    if (depth > MAX_SERIALIZE_DEPTH) return "[depth-limit]";
    try {
        if (Array.isArray(value)) {
            return value.slice(0, MAX_ARRAY_ITEMS).map((v) => serialize(v, depth + 1));
        }
        if (value instanceof Map) {
            const out: Record<string, unknown> = {};
            let i = 0;
            for (const [k, v] of value) {
                if (i >= MAX_OBJECT_KEYS) break;
                out[String(k)] = serialize(v, depth + 1);
                i += 1;
            }
            return { kind: "Map", size: value.size, entries: out };
        }
        if (value instanceof Set) {
            return {
                kind: "Set",
                size: value.size,
                values: [...value].slice(0, MAX_ARRAY_ITEMS).map((v) => serialize(v, depth + 1)),
            };
        }
        if (typeof (value as Promise<unknown>).then === "function") {
            return "[Promise]";
        }
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value as object).slice(0, MAX_OBJECT_KEYS)) {
            out[key] = serialize((value as Record<string, unknown>)[key], depth + 1);
        }
        return out;
    } catch {
        return "[unserializable]";
    }
}

/** 尝试解析一个 service getter 的返回值形状（深度受限）。 */
export function tryShape(session: unknown, getter: string): unknown {
    try {
        const fn = (session as Record<string, unknown>)[getter];
        if (typeof fn !== "function") return null;
        const value = fn.call(session);
        if (value === null || value === undefined) return null;
        return serialize(value);
    } catch {
        return "[error]";
    }
}

/** 数据 getter 方法名模式（探测返回形状用）。 */
const DATA_GETTER_RE = /^(get|query|fetch|load)/i;

/** 探测 service 的关键数据 getter 返回形状（取前几个无参调用）。 */
export function shapeKeyGetters(
    session: unknown,
    serviceMethods: string[],
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const candidates = serviceMethods.filter(
        (m) => DATA_GETTER_RE.test(m) && !m.endsWith("Listener"),
    );
    for (const m of candidates.slice(0, 8)) {
        out[m] = tryShape(session, m);
    }
    return out;
}
