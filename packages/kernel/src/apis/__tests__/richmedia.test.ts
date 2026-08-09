/**
 * richmedia.ts extractFileList 基线测试（fallow 重构目标，untested risk）
 *
 * 覆盖 getGroupFileList 返回形状提取：
 *  - 数组直接返回
 *  - { items } / { fileList } / { list } 兼容
 *  - null / 非对象 / 无匹配键 → 空数组
 */
import { describe, expect, it } from "vitest";
import { extractFileList, type GroupFileListItem } from "../richmedia.js";

const file: GroupFileListItem = { fileInfo: { fileId: "1" } as never };
const folder: GroupFileListItem = { folderInfo: { folderUid: "f1" } as never };

describe("extractFileList", () => {
    it("数组直接返回", () => {
        expect(extractFileList([file, folder])).toEqual([file, folder]);
    });

    it("{ items } 提取", () => {
        expect(extractFileList({ items: [file] })).toEqual([file]);
    });

    it("{ fileList } 提取", () => {
        expect(extractFileList({ fileList: [folder] })).toEqual([folder]);
    });

    it("{ list } 提取", () => {
        expect(extractFileList({ list: [file] })).toEqual([file]);
    });

    it("null 返回空数组", () => {
        expect(extractFileList(null)).toEqual([]);
    });

    it("非对象（字符串）返回空数组", () => {
        expect(extractFileList("x")).toEqual([]);
    });

    it("对象无匹配键返回空数组", () => {
        expect(extractFileList({ other: [file] })).toEqual([]);
    });

    it("items 非数组返回空数组", () => {
        expect(extractFileList({ items: "not-array" })).toEqual([]);
    });
});
