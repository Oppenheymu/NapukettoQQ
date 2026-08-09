/**
 * group-notify.ts extract 系列基线测试（列表提取纯函数，fallow 0% 覆盖）
 *
 * 锁定 extractNotifyList / extractMemberList 的宽容形状兼容：
 *  - 直接数组 / notifies 字段 / groupNotifies 字段 / memberList / list
 *  - 非数组 / 非对象 / 缺字段 → 空数组
 */
import { describe, expect, it } from "vitest";
import { extractMemberList, extractNotifyList } from "../group-notify.js";

describe("extractNotifyList", () => {
    it("直接数组 → 原样返回", () => {
        const arr = [{ seq: "1", type: 1 }];
        expect(extractNotifyList(arr)).toEqual(arr);
    });

    it("notifies 字段 → 返回该字段", () => {
        const notifies = [{ seq: "1", type: 1 }];
        expect(extractNotifyList({ notifies })).toEqual(notifies);
    });

    it("groupNotifies 字段 → 返回该字段", () => {
        const groupNotifies = [{ seq: "2", type: 2 }];
        expect(extractNotifyList({ groupNotifies })).toEqual(groupNotifies);
    });

    it("非数组 / 非对象 / 缺字段 → 空数组", () => {
        expect(extractNotifyList(null)).toEqual([]);
        expect(extractNotifyList(undefined)).toEqual([]);
        expect(extractNotifyList("str")).toEqual([]);
        expect(extractNotifyList(42)).toEqual([]);
        expect(extractNotifyList({ other: 1 })).toEqual([]);
        expect(extractNotifyList({ notifies: "not-array" })).toEqual([]);
    });
});

describe("extractMemberList", () => {
    it("直接数组 → 原样返回", () => {
        const arr = [{ uid: "u1" }];
        expect(extractMemberList(arr)).toEqual(arr);
    });

    it("memberList 字段 → 返回该字段", () => {
        const memberList = [{ uid: "u1", nick: "A" }];
        expect(extractMemberList({ memberList })).toEqual(memberList);
    });

    it("list 字段 → 返回该字段", () => {
        const list = [{ uid: "u2", nick: "B" }];
        expect(extractMemberList({ list })).toEqual(list);
    });

    it("非数组 / 非对象 / 缺字段 → 空数组", () => {
        expect(extractMemberList(null)).toEqual([]);
        expect(extractMemberList(undefined)).toEqual([]);
        expect(extractMemberList("str")).toEqual([]);
        expect(extractMemberList(42)).toEqual([]);
        expect(extractMemberList({ other: 1 })).toEqual([]);
        expect(extractMemberList({ memberList: "not-array" })).toEqual([]);
    });
});
