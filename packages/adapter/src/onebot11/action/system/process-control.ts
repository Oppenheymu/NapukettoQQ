/**
 * bot_exit / set_restart 动作：退出 / 重启（P2-12）
 *
 * exit/restart 回调由装配方注入（boot.cjs 接进程控制）。未配置时明确报错。
 */

import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const botExitSchema = z.object({});

type BotExitPayload = z.infer<typeof botExitSchema>;

/** 退出/重启依赖（回调由装配方注入，OneBotApi 视图）。 */
export type ProcessControlDeps = Pick<OneBotApi, "exit" | "restart">;

/** 退出机器人进程（P2-12）。 */
export class BotExitAction extends BaseAction<BotExitPayload, null> {
    readonly name = "bot_exit";
    readonly schema = botExitSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: ProcessControlDeps;

    constructor(deps: ProcessControlDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(_payload: BotExitPayload): Promise<null> {
        if (this.deps.exit === undefined) {
            throw new Error("bot_exit 未配置（装配方未注入退出回调）");
        }
        await this.deps.exit();
        return null;
    }
}

/** 重启机器人（P2-12；重启交给装配方，缺省退化为退出）。 */
export class SetRestartAction extends BaseAction<BotExitPayload, null> {
    readonly name = "set_restart";
    readonly schema = botExitSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: ProcessControlDeps;

    constructor(deps: ProcessControlDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(_payload: BotExitPayload): Promise<null> {
        const restart = this.deps.restart ?? this.deps.exit;
        if (restart === undefined) {
            throw new Error("set_restart 未配置（装配方未注入重启回调）");
        }
        await restart();
        return null;
    }
}
