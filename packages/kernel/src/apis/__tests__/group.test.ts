/**
 * group.ts extractGroupDetail 基线测试（fallow 重构目标，untested risk）
 *
 * 覆盖 getGroupDetailInfo 返回形状提取：
 *  - result 为对象 → 详情直接返回
 *  - result 非对象 → 从 raw.groupInfo / detailInfo / info 提取
 *  - 全无 → null
 */
import { describe, expect, it } from "vitest";
import { extractGroupDetail } from "../group.js";

describe("extractGroupDetail", () => {
    it("result 为对象直接返回", () => {
        const detail = { groupCode: "123" } as never;
        expect(extractGroupDetail(detail, { result: 0 })).toBe(detail);
    });

    it("result 为 0 时从 raw.groupInfo 提取", () => {
        const info = { groupCode: "1" } as never;
        expect(extractGroupDetail(0, { groupInfo: info })).toBe(info);
    });

    it("result 为 0 时从 raw.detailInfo 提取", () => {
        const info = { groupCode: "2" } as never;
        expect(extractGroupDetail(0, { detailInfo: info })).toBe(info);
    });

    it("result 为 0 时从 raw.info 提取", () => {
        const info = { groupCode: "3" } as never;
        expect(extractGroupDetail(0, { info })).toBe(info);
    });

    it("result 为 0 且候选为 null → null", () => {
        expect(extractGroupDetail(0, { groupInfo: null })).toBeNull();
    });

    it("result 为 null 且无候选 → null", () => {
        expect(extractGroupDetail(null, {})).toBeNull();
    });

    it("result 非对象非 0（如字符串）且无候选 → null", () => {
        expect(extractGroupDetail("abc", {})).toBeNull();
    });
});
