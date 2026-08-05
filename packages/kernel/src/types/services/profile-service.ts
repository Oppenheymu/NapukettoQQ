/**
 * NodeIKernelProfileService：资料服务接口面（自研描述，非移植）
 *
 * 依据：运行时反射 + NapCat 公开类型作「说明书」理解 QQ wrapper 契约
 * （接口签名是外部系统的事实，我们自研描述其形状，零复制实现）。
 * 只收录 apis/profile 需要的方法；其余按需探测后补齐。
 */
import type { GeneralCallResult } from "./msg-service.js";

/** 资料服务。 */
export interface NodeIKernelProfileService {
    addKernelProfileListener(listener: unknown): number;
    removeKernelProfileListener(listenerId: number): void;
    /** 设置个性签名（set_self_longnick）。 */
    setLongNick(longNick: string): Promise<unknown>;
    /** 设置昵称（set_qq_profile）。 */
    setNickName(nickName: string): Promise<unknown>;
    /** 设置头像（set_qq_avatar）。 */
    setHeader(filePath: string): Promise<GeneralCallResult>;
    isNull(): boolean;
}
