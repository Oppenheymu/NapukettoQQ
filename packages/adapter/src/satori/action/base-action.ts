/**
 * Satori 动作基类（响应形态与 OB11 不同：直接返回资源对象，错误用 HTTP 状态码）
 *
 * - `run(payload)`：zod 校验失败 → SatoriActionError(400)；_handle 抛的
 *   KernelError → satoriHttpStatusMap 映射 HTTP 状态码（ADR-017）
 * - `SatoriActionError`：带 HTTP 状态码的动作错误（transport 层直接透传状态码）
 */
import { isKernelError } from "@napuketto/kernel";
import type { ZodType } from "zod";
import { satoriHttpStatusMap } from "../helper/error.js";

/** 动作错误（带 HTTP 状态码；由 transport 层透传）。 */
export class SatoriActionError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

/** 校验失败默认状态码。 */
const INVALID_PARAM_STATUS = 400;
/** 兜底错误状态码。 */
const UNKNOWN_STATUS = 500;

/**
 * Satori 动作基类：校验 + 执行 + 错误映射。
 * 成功返回资源对象（或数组/分页列表），失败抛 SatoriActionError。
 */
export abstract class BaseSatoriAction<TPayload, TReturn> {
    /** 动作名（resource.method，如 "message.create"）。 */
    abstract readonly name: string;
    /** 参数校验 schema。 */
    abstract readonly schema: ZodType<TPayload>;

    /** 校验并执行（HTTP/WS 共用）。 */
    async run(payload: unknown): Promise<TReturn> {
        const parsed = this.schema.safeParse(payload);
        if (!parsed.success) {
            throw new SatoriActionError(INVALID_PARAM_STATUS, "参数校验失败");
        }
        try {
            return await this._handle(parsed.data);
        } catch (err) {
            if (err instanceof SatoriActionError) {
                throw err;
            }
            if (isKernelError(err)) {
                throw new SatoriActionError(
                    satoriHttpStatusMap[err.code] ?? UNKNOWN_STATUS,
                    err.message,
                );
            }
            throw new SatoriActionError(
                UNKNOWN_STATUS,
                err instanceof Error ? err.message : "未知错误",
            );
        }
    }

    /** 动作实现（只抛错或返回资源；不包装响应）。 */
    protected abstract _handle(payload: TPayload): Promise<TReturn>;
}
