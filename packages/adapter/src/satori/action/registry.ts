/**
 * Satori 动作注册表（按动作名索引，构建后只读）。
 * Satori 动作响应形态与 OB11 不同（直接返回资源 + HTTP 状态码），独立注册表。
 */
import type { BaseSatoriAction } from "./base-action.js";

export class SatoriActionRegistry {
    private readonly actions = new Map<string, BaseSatoriAction<unknown, unknown>>();

    register(action: BaseSatoriAction<unknown, unknown>): void {
        this.actions.set(action.name, action);
    }

    get(name: string): BaseSatoriAction<unknown, unknown> | undefined {
        return this.actions.get(name);
    }

    has(name: string): boolean {
        return this.actions.has(name);
    }

    get names(): string[] {
        return [...this.actions.keys()];
    }
}
