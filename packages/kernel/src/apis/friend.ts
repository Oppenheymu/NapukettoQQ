/**
 * FriendApi：好友语义化 API（ADR-009 统一错误语义）
 *
 * 内部解包原生返回：成功返回纯业务值，失败抛 KernelError。
 * 方法面（P2-4）：好友列表（uid + 昵称/备注）。
 */
import { kernelError } from "../errors.js";
import type { BuddyCategory, NodeIKernelBuddyService } from "../types/services/buddy-service.js";
import type { NodeIQQNTWrapperSession } from "../types/wrapper.js";

/** 好友条目（uid + 昵称/备注，昵称由 buddy service 缓存补全）。 */
export interface Friend {
    uid: string;
    uin: string;
    nickname: string;
    remark: string;
}

/** FriendApi 构造选项。 */
export interface FriendApiOptions {
    /** uid→uin 转换器（通常注入 GroupApi.uidToUin）；缺省 uin 退化为 uid。 */
    uidToUin?: (uids: string[]) => Promise<Map<string, string>>;
}

/** 好友 API：从 session 拿 buddy service，包装成语义化方法。 */
export class FriendApi {
    private readonly service: NodeIKernelBuddyService;
    private readonly uidToUin: ((uids: string[]) => Promise<Map<string, string>>) | undefined;

    constructor(session: NodeIQQNTWrapperSession, opts: FriendApiOptions = {}) {
        const service = session.getBuddyService() as unknown as NodeIKernelBuddyService | null;
        if (service === null || service === undefined) {
            throw kernelError("getBuddyService() 返回空（session 未 init）", "INVALID_STATE");
        }
        this.service = service;
        this.uidToUin = opts.uidToUin;
    }

    /** 好友列表（分类拍平为 Friend[]；昵称/备注从 service 缓存读取）。 */
    async getFriendList(): Promise<Friend[]> {
        let categories: BuddyCategory[];
        try {
            categories = await this.service.getBuddyListFromCache(0);
        } catch {
            const raw = await this.service.getBuddyListV2("cli", true, 0);
            if (raw.result !== 0) {
                throw kernelError(`getBuddyListV2 失败: ${raw.errMsg}`, "UNKNOWN");
            }
            categories = raw.data;
        }
        const uids = categories.flatMap((cat) => cat.buddyUids);
        let uinMap = new Map<string, string>();
        if (this.uidToUin !== undefined) {
            uinMap = await this.uidToUin(uids);
        }
        const out: Friend[] = [];
        for (const uid of uids) {
            out.push({
                uid,
                uin: uinMap.get(uid) ?? uid,
                nickname: this.service.getBuddyNick(uid),
                remark: this.service.getBuddyRemark(uid),
            });
        }
        return out;
    }

    /** 判断是否好友。 */
    isBuddy(uid: string): boolean {
        return this.service.isBuddy(uid);
    }
}
