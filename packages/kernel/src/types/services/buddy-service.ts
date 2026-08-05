/**
 * NodeIKernelBuddyService：好友服务接口面（自研描述，非移植）
 *
 * 依据：getBuddyService() 运行时反射 + NapCat 公开类型作「说明书」理解 QQ wrapper
 * 契约（接口签名是外部系统的事实，自研描述其形状，零复制实现）。
 * 只收录 apis/friend 当前需要的方法；其余按需探测后补齐。
 */
import type { GeneralCallResult } from "./msg-service.js";

/** 好友列表分类（getBuddyListV2 返回，说明书参考）。 */
export interface BuddyCategory {
    categoryId: number;
    categorySortId: number;
    categroyName: string;
    categroyMbCount: number;
    onlineCount: number;
    buddyUids: string[];
}

/** 好友服务：apis/friend 用到的核心方法面。 */
export interface NodeIKernelBuddyService {
    addKernelBuddyListener(listener: unknown): number;
    removeKernelBuddyListener(listenerId: number): void;
    getBuddyListV2(
        callFrom: string,
        isPullRefresh: boolean,
        reqType: number,
    ): Promise<GeneralCallResult & { data: BuddyCategory[] }>;
    getBuddyListFromCache(reqType: number): Promise<BuddyCategory[]>;
    getBuddyNick(uid: string): string;
    getBuddyRemark(uid: string): string;
    isBuddy(uid: string): boolean;
}
