/**
 * get_version_info 动作：获取版本信息（本地组装，P2-11）
 *
 * appVersion 由装配方注入（kernel wrapper 版本或 NAPUTO_QQ_VERSION）。
 */

import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import type { VersionInfo } from "../../types/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getVersionInfoSchema = z.object({});

type GetVersionInfoPayload = z.infer<typeof getVersionInfoSchema>;

/** get_version_info 依赖（appVersion 由装配方注入，OneBotApi 视图）。 */
export type GetVersionInfoDeps = Pick<OneBotApi, "appVersion">;

/** 获取版本信息（本地组装，P2-11）。 */
export class GetVersionInfoAction extends BaseAction<GetVersionInfoPayload, VersionInfo> {
    readonly name = "get_version_info";
    readonly schema = getVersionInfoSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: GetVersionInfoDeps;

    constructor(deps: GetVersionInfoDeps) {
        super();
        this.deps = deps;
    }

    protected _handle(_payload: GetVersionInfoPayload): Promise<VersionInfo> {
        return Promise.resolve({
            app_name: "napuketto-qq",
            app_version: this.deps.appVersion,
            protocol_version: "v11",
        });
    }
}
