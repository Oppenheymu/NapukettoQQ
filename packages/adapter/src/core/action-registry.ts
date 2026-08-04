/**
 * 动作注册表：按动作名索引（构建后只读）。
 */
import type { BaseAction } from "./BaseAction.js";

export class ActionRegistry {
    private readonly actions = new Map<string, BaseAction<unknown, unknown>>();

    register(action: BaseAction<unknown, unknown>): void {
        this.actions.set(action.name, action);
    }

    get(name: string): BaseAction<unknown, unknown> | undefined {
        return this.actions.get(name);
    }

    has(name: string): boolean {
        return this.actions.has(name);
    }

    get names(): string[] {
        return [...this.actions.keys()];
    }
}
