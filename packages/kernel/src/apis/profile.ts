/**
 * ProfileApi：资料语义化 API（ADR-009 统一错误语义，P2-14/P2-15）
 *
 * - setLongNick：set_self_longnick
 * - setNickName：set_qq_profile
 * - setHeader：set_qq_avatar
 * - getStrangerInfo：get_stranger_info（uin → uid → 详情扁平化）
 */
import { kernelError } from "../infra/errors.js";
import type {
    NodeIKernelProfileService,
    UserDetailInfoByUin,
} from "../types/services/profile-service.js";
import type { NodeIQQNTWrapperSession } from "../types/wrapper.js";

/** 陌生人信息（get_stranger_info 返回）。 */
export interface StrangerInfo {
    user_id: number;
    uid: string;
    nickname: string;
    age: number;
    qid: string;
    qq_level: number;
    sex: "male" | "female" | "unknown";
    long_nick: string;
    reg_time: number;
    is_vip: boolean;
    is_years_vip: boolean;
    vip_level: number;
    remark: string;
    status: number;
    login_days: number;
}

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

/** 扁平化两份详情 → StrangerInfo（宽松取值，字段缺失给默认）。 */
function flattenStrangerInfo(
    uin: string,
    uid: string,
    byUin: UserDetailInfoByUin,
    info: UserDetailInfoByUin,
): StrangerInfo {
    const coreInfo = info.detail?.simpleInfo?.coreInfo ?? byUin.detail?.simpleInfo?.coreInfo;
    const baseInfo = info.detail?.simpleInfo?.baseInfo ?? byUin.detail?.simpleInfo?.baseInfo;
    const vasInfo = info.detail?.simpleInfo?.vasInfo ?? byUin.detail?.simpleInfo?.vasInfo;
    const commonExt = info.detail?.commonExt ?? byUin.detail?.commonExt;
    const status = info.detail?.simpleInfo?.status?.status ?? 0;
    return {
        user_id: Number(uin),
        uid,
        nickname: coreInfo?.nick ?? "",
        age: baseInfo?.age ?? 0,
        qid: baseInfo?.qid ?? "",
        qq_level: commonExt?.qqLevel ?? 0,
        sex: mapSex(baseInfo?.sex),
        long_nick: baseInfo?.longNick ?? "",
        reg_time: commonExt?.regTime ?? 0,
        is_vip: vasInfo?.svipFlag ?? false,
        is_years_vip: vasInfo?.yearVipFlag ?? false,
        vip_level: vasInfo?.vipLevel ?? 0,
        remark: coreInfo?.remark ?? "",
        status,
        login_days: 0,
    };
}

/** 性别数值 → OB11 字符串（1=男 2=女 其余 unknown）。 */
function mapSex(raw: number | undefined): "male" | "female" | "unknown" {
    if (raw === 1) {
        return "male";
    }
    if (raw === 2) {
        return "female";
    }
    return "unknown";
}
