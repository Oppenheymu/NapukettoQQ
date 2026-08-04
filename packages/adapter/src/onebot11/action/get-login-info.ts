/**
 * get_login_info 动作：获取登录信息
 *
 * 骨架实现：zod 校验 + 占位调用（P1 接入 kernel selfInfo 后替换）。
 */

import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import type { LoginInfo } from "../types/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const getLoginInfoSchema = z.object({});

type GetLoginInfoPayload = z.infer<typeof getLoginInfoSchema>;

/** 获取登录信息（P1 接入 kernel selfInfo 后返回真实数据）。 */
export class GetLoginInfoAction extends BaseAction<GetLoginInfoPayload, LoginInfo> {
    readonly name = "get_login_info";
    readonly schema = getLoginInfoSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    protected _handle(_payload: GetLoginInfoPayload): Promise<LoginInfo> {
        // TODO(P1): 读 kernel selfInfo（登录成功后由 kernel 维护）
        return Promise.reject(new Error("get_login_info 尚未接入 kernel（P1 实现）"));
    }
}
