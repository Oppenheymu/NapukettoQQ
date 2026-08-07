/**
 * 未实现动作（501）：平台支持但适配器未实现（规范：501 而非 404）。
 */
import { z } from "zod";
import { BaseSatoriAction, SatoriActionError } from "./base-action.js";

/** 未实现动作：schema 接受任意对象，执行抛 501。 */
export class NotImplementedAction extends BaseSatoriAction<unknown, never> {
    readonly name: string;
    readonly schema = z.object({}).passthrough();

    constructor(name: string) {
        super();
        this.name = name;
    }

    protected async _handle(_payload: unknown): Promise<never> {
        throw new SatoriActionError(501, `平台不支持该操作: ${this.name}`);
    }
}
