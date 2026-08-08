/**
 * ProfileApi：资料语义化 API（ADR-009 统一错误语义，P2-14/P2-15）
 *
 * - setLongNick：set_self_longnick
 * - setNickName：set_qq_profile
 * - setHeader：set_qq_avatar
 * - getStrangerInfo：get_stranger_info（uin → uid → 详情扁平化）
 */
import { kernelError } from "../infra/index.js";
import type { NodeIKernelProfileService, NodeIQQNTWrapperSession } from "../types/index.js";
import { checkLooseResult } from "./result.js";
import type { StrangerInfo } from "./stranger-info.js";
import { flattenStrangerInfo } from "./stranger-info.js";

/** 资料 API：从 session 拿 profile service，包装成语义化方法。 */
export class ProfileApi {
    private readonly service: NodeIKernelProfileService;

    constructor(session: NodeIQQNTWrapperSession) {
        const service = session.getProfileService() as unknown as NodeIKernelProfileService | null;
        if (service === null || service === undefined) {
            throw kernelError("getProfileService() 返回空（session 未 init）", "INVALID_STATE");
        }
        this.service = service;
    }

    /** 设置个性签名（set_self_longnick）。 */
    async setLongNick(longNick: string): Promise<void> {
        const res = (await this.service.setLongNick(longNick)) as
            | { result?: unknown; errMsg?: unknown }
            | undefined;
        checkLooseResult("setLongNick", res);
    }

    /** 设置昵称（set_qq_profile）。 */
    async setNickName(nickName: string): Promise<void> {
        const res = (await this.service.setNickName(nickName)) as
            | { result?: unknown; errMsg?: unknown }
            | undefined;
        checkLooseResult("setNickName", res);
    }

    /** 设置头像（set_qq_avatar；filePath 为本地路径）。 */
    async setHeader(filePath: string): Promise<void> {
        const raw = await this.service.setHeader(filePath);
        if (raw.result !== 0) {
            throw kernelError(`setHeader 失败: ${raw.errMsg}`, "UNKNOWN");
        }
    }

    /** 获取陌生人信息（get_stranger_info；uin 为用户 QQ 号）。 */
    async getStrangerInfo(uin: string): Promise<StrangerInfo> {
        const byUin = await this.service.getUserDetailInfoByUin(uin);
        const detailUid = byUin.detail?.uid;
        let uid = uin;
        if (detailUid !== undefined && detailUid !== "") {
            uid = detailUid;
        }
        const info = await this.service.getUserDetailInfo(uid);
        return flattenStrangerInfo(uin, uid, byUin, info);
    }
}
