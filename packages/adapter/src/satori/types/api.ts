/**
 * Satori 分页与通用 API 类型（协议 v1，规范参考 satori.chat/zh-CN/protocol/api.html）
 */

/** 分页列表（next 为空表示无更多数据）。 */
export interface List<T> {
    data: T[];
    next?: string;
}

/** 双向分页列表（message.list 等）。 */
export interface BidiList<T> {
    data: T[];
    prev?: string;
    next?: string;
}

/** 分页方向（message.list）。 */
export const Direction = {
    BEFORE: "before",
    AFTER: "after",
    AROUND: "around",
} as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

/** 排序方向。 */
export const Order = {
    ASC: "asc",
    DESC: "desc",
} as const;
export type Order = (typeof Order)[keyof typeof Order];

/** Satori 动作名（resource.method，如 "message.create"）。 */
export type SatoriAction = string;
