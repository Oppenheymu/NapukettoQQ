/**
 * get_status 动作：获取运行状态（本地组装，P2-11）
 *
 * 返回与心跳 status 同构的 OB11Status（online/good + 扩展字段）。
 */

import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OB11Status } from "../../event/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getStatusSchema = z.object({});

type GetStatusPayload = z.infer<typeof getStatusSchema>;

/** 获取运行状态（本地组装，P2-11）。 */
export class GetStatusAction extends BaseAction<GetStatusPayload, OB11Status> {
    readonly name = "get_status";
    readonly schema = getStatusSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    protected _handle(_payload: GetStatusPayload): Promise<OB11Status> {
        return Promise.resolve({
            online: true,
            good: true,
        });
    }
}
