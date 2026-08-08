/**
 * grayTip 元素工具（OB11 / Satori 共用，2026-08-08 克隆合并）
 *
 * grayTip（系统提示消息）涉及的操作者/成员 uid 需要批量 uid→uin 转换，
 * 两协议翻译层共用同一套收集逻辑。
 */
import type { RawMessage } from "@napuketto/kernel";

/** 收集 grayTip 涉及的 uid（批量 uidToUin 用）。 */
export function collectGrayTipUids(msg: RawMessage): string[] {
    const uids = new Set<string>();
    for (const el of msg.elements) {
        const g = el.grayTipElement;
        if (g === undefined) {
            continue;
        }
        const revoke = g.revokeElement;
        if (revoke?.operatorUid !== undefined && revoke.operatorUid !== "") {
            uids.add(revoke.operatorUid);
        }
        const grp = g.groupElement;
        if (grp === undefined) {
            continue;
        }
        if (grp.memberUid !== undefined && grp.memberUid !== "") {
            uids.add(grp.memberUid);
        }
        if (grp.adminUid !== undefined && grp.adminUid !== "") {
            uids.add(grp.adminUid);
        }
        if (grp.shutUp?.admin?.uid !== undefined && grp.shutUp.admin.uid !== "") {
            uids.add(grp.shutUp.admin.uid);
        }
        if (grp.shutUp?.member?.uid !== undefined && grp.shutUp.member.uid !== "") {
            uids.add(grp.shutUp.member.uid);
        }
    }
    return [...uids];
}
