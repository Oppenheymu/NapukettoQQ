/**
 * ProfileApi：资料语义化 API（ADR-009 统一错误语义，P2-14）
 *
 * - setLongNick：set_self_longnick
 * - setNickName：set_qq_profile
 * - setHeader：set_qq_avatar
 */
import { kernelError } from "../errors.js";
import type { NodeIKernelProfileService } from "../types/services/profile-service.js";
import type { NodeIQQNTWrapperSession } from "../types/wrapper.js";

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
        if (
            res !== undefined &&
            res !== null &&
            typeof res.result === "number" &&
            res.result !== 0
        ) {
            throw kernelError(`setLongNick 失败: ${String(res.errMsg ?? "")}`, "UNKNOWN");
        }
    }

    /** 设置昵称（set_qq_profile）。 */
    async setNickName(nickName: string): Promise<void> {
        const res = (await this.service.setNickName(nickName)) as
            | { result?: unknown; errMsg?: unknown }
            | undefined;
        if (
            res !== undefined &&
            res !== null &&
            typeof res.result === "number" &&
            res.result !== 0
        ) {
            throw kernelError(`setNickName 失败: ${String(res.errMsg ?? "")}`, "UNKNOWN");
        }
    }

    /** 设置头像（set_qq_avatar；filePath 为本地路径）。 */
    async setHeader(filePath: string): Promise<void> {
        const raw = await this.service.setHeader(filePath);
        if (raw.result !== 0) {
            throw kernelError(`setHeader 失败: ${raw.errMsg}`, "UNKNOWN");
        }
    }
}
