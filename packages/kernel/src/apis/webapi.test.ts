/**
 * webapi.ts parseHonorList 基线测试（fallow CRITICAL）
 *
 * 锁定 honorlist 页面 HTML → 荣誉列表的解析规则：
 *  - 正则提取 window.__INITIAL_STATE__ JSON
 *  - type 分支：TALKATIVE 读 talkativeList，其余读 actorList
 *  - 解析失败 / 非数组 / 非对象项 → 宽容跳过，返回空或过滤
 */
import { describe, expect, it } from "vitest";
import { parseHonorList, WebHonorType } from "./webapi.js";

describe("parseHonorList", () => {
    it("talkative 页：提取 __INITIAL_STATE__.talkativeList", () => {
        const html =
            '<script>window.__INITIAL_STATE__={"talkativeList":[{"uin":"1","name":"A","avatar":"/a.png","desc":"d"}]};</script>';
        expect(parseHonorList(html, WebHonorType.TALKATIVE)).toEqual([
            { uin: "1", name: "A", avatar: "/a.png", desc: "d" },
        ]);
    });

    it("非 talkative（actor 类）：读 actorList", () => {
        const html =
            '<script>window.__INITIAL_STATE__={"actorList":[{"uin":"2","name":"B"}]};</script>';
        expect(parseHonorList(html, WebHonorType.PERFORMER)).toEqual([
            { uin: "2", name: "B", avatar: "", desc: "" },
        ]);
    });

    it("字段缺失 → 默认空字符串", () => {
        const html = '<script>window.__INITIAL_STATE__={"actorList":[{}]};</script>';
        expect(parseHonorList(html, WebHonorType.LEGEND)).toEqual([
            { uin: "", name: "", avatar: "", desc: "" },
        ]);
    });

    it("无 __INITIAL_STATE__ → 空数组", () => {
        expect(parseHonorList("<html></html>", WebHonorType.TALKATIVE)).toEqual([]);
    });

    it("__INITIAL_STATE__ 非法 JSON → 空数组", () => {
        expect(
            parseHonorList(
                "<script>window.__INITIAL_STATE__=not-json;</script>",
                WebHonorType.TALKATIVE,
            ),
        ).toEqual([]);
    });

    it("目标列表非数组（talkative 页缺字段）→ 空数组", () => {
        expect(
            parseHonorList(
                '<script>window.__INITIAL_STATE__={"actorList":[]};</script>',
                WebHonorType.TALKATIVE,
            ),
        ).toEqual([]);
    });

    it("列表含 null / 非对象项 → 过滤", () => {
        const html =
            '<script>window.__INITIAL_STATE__={"actorList":[{"uin":"1"},null,"str",2]};</script>';
        expect(parseHonorList(html, WebHonorType.EMOTION)).toEqual([
            { uin: "1", name: "", avatar: "", desc: "" },
        ]);
    });

    it("多列表共存：各类型读各自分支", () => {
        const html =
            '<script>window.__INITIAL_STATE__={"talkativeList":[{"uin":"t"}],"actorList":[{"uin":"a"}]};</script>';
        expect(parseHonorList(html, WebHonorType.TALKATIVE)).toEqual([
            { uin: "t", name: "", avatar: "", desc: "" },
        ]);
        expect(parseHonorList(html, WebHonorType.PERFORMER)).toEqual([
            { uin: "a", name: "", avatar: "", desc: "" },
        ]);
    });
});
