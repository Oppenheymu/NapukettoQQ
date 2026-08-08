/**
 * OB11 用户 ID 解析（uin → uid，多个动作共用，2026-08-08 克隆合并）
 */

import { kernelError } from "@napuketto/kernel";

/** 解析单个 uin → uid（失败抛 KernelError INVALID_PARAM）。 */
export async function resolveUid(
    uin: string,
    uinToUid: (uins: string[]) => Promise<Map<string, string>>,
): Promise<string> {
    const uidMap = await uinToUid([uin]);
    const uid = uidMap.get(uin);
    if (uid === undefined) {
        throw kernelError(`用户 ${uin} 的 uid 解析失败`, "INVALID_PARAM");
    }
    return uid;
}
