/**
 * get_robot_uin_range 动作：获取机器人 QQ 号范围（本地组装，P2-11）
 *
 * NapCat 从配置返回；我们给通用范围（min/max）。
 */

import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getRobotUinRangeSchema = z.object({});

type GetRobotUinRangePayload = z.infer<typeof getRobotUinRangeSchema>;

/** QQ 号下限。 */
const UIN_MIN = 10_001;
/** QQ 号上限。 */
const UIN_MAX = 4_294_967_295;

/** 获取机器人 QQ 号范围（P2-11 本地组装）。 */
export class GetRobotUinRangeAction extends BaseAction<
    GetRobotUinRangePayload,
    { min: number; max: number }
> {
    readonly name = "get_robot_uin_range";
    readonly schema = getRobotUinRangeSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    protected _handle(_payload: GetRobotUinRangePayload): Promise<{ min: number; max: number }> {
        return Promise.resolve({ min: UIN_MIN, max: UIN_MAX });
    }
}
