/**
 * NodeIKernelProfileLikeService：资料点赞服务接口面（自研描述，非移植）
 *
 * 依据：运行时反射 + NapCat 公开类型作「说明书」理解 QQ wrapper 契约
 * （接口签名是外部系统的事实，我们自研描述其形状，零复制实现）。
 * 只收录 apis/profile-like 需要的方法；其余按需探测后补齐。
 */

/** 点赞返回（setBuddyProfileLike，说明书参考）。 */
export interface BuddyProfileLikeResult {
    result: number;
    errMsg: string;
    succCounts: number;
}

/** 资料点赞服务。 */
export interface NodeIKernelProfileLikeService {
    addKernelProfileLikeListener(listener: unknown): number;
    removeKernelProfileLikeListener(listenerId: number): void;
    /** 点赞（send_like；sourceId=71 赞来源，doLikeCount 次数）。 */
    setBuddyProfileLike(arg: {
        friendUid: string;
        sourceId: number;
        doLikeCount: number;
        doLikeTollCount: number;
    }): Promise<BuddyProfileLikeResult>;
    isNull(): boolean;
}
