/**
 * get_login_info 动作：获取登录信息（P2-4 注入 self）
 */

import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { LoginInfo } from "../../types/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getLoginInfoSchema = z.object({});

type GetLoginInfoPayload = z.infer<typeof getLoginInfoSchema>;

/** 获取登录信息（self 由装配方注入，P2-5 接 kernel selfInfo 维护后取真实昵称）。 */
export class GetLoginInfoAction extends BaseAction<GetLoginInfoPayload, LoginInfo> {
    readonly name = "get_login_info";
    readonly schema = getLoginInfoSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly self: { uin: string; nickname: string };

    constructor(self: { uin: string; nickname: string }) {
        super();
        this.self = self;
    }

    protected _handle(_payload: GetLoginInfoPayload): Promise<LoginInfo> {
        return Promise.resolve({
            user_id: Number(this.self.uin),
            nickname: this.self.nickname,
        });
    }
}
