/**
 * friend.ts toDoubtFriendRequestInfo 基线测试（fallow 重构目标，untested risk）
 *
 * 覆盖可疑好友申请转换：
 *  - 必填字段（flag/uin/type）
 *  - 可选字段条件赋值（exactOptionalPropertyTypes）
 *  - uid→uin 转换缺失时回退 uid
 */
import { describe, expect, it } from "vitest";
import { toDoubtFriendRequestInfo } from "../friend.js";

describe("toDoubtFriendRequestInfo", () => {
    it("仅必填字段（uinMap 无命中时回退 uid 数字转换）", () => {
        const item = { uid: "10001" } as never;
        expect(toDoubtFriendRequestInfo(item, new Map())).toEqual({
            flag: "10001",
            uin: 10001,
            type: "doubt",
        });
    });

    it("uinMap 命中时 uin 用转换值", () => {
        const item = { uid: "u1" } as never;
        expect(toDoubtFriendRequestInfo(item, new Map([["u1", "10001"]]))).toMatchObject({
            flag: "u1",
            uin: 10001,
            type: "doubt",
        });
    });

    it("全部可选字段填充", () => {
        const item = {
            uid: "u1",
            nick: "小明",
            source: "好友推荐",
            reason: "认识一下",
            msg: "你好",
            groupCode: "g1",
            reqTime: "123456",
        } as never;
        expect(toDoubtFriendRequestInfo(item, new Map([["u1", "10001"]]))).toEqual({
            flag: "u1",
            uin: 10001,
            nick: "小明",
            source: "好友推荐",
            reason: "认识一下",
            msg: "你好",
            group_code: "g1",
            time: "123456",
            type: "doubt",
        });
    });

    it("可选字段缺失不出现键（exactOptionalPropertyTypes）", () => {
        const item = { uid: "u1" } as never;
        const result = toDoubtFriendRequestInfo(item, new Map());
        expect("nick" in result).toBe(false);
        expect("source" in result).toBe(false);
        expect("reason" in result).toBe(false);
        expect("msg" in result).toBe(false);
        expect("group_code" in result).toBe(false);
        expect("time" in result).toBe(false);
    });
});
