/**
 * wrapper-config.ts parseAppidFromMajor 基线测试（fallow 重构目标，untested risk）
 *
 * 覆盖 major.node appid 提取：
 *  - QQAppId/ 标记后纯数字串提取
 *  - 多个标记取第一个纯数字
 *  - 文件不存在 / 读取失败 → null
 */
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseAppidFromMajor, resolveAppidQua } from "../wrapper-config.js";

/** 临时文件路径。 */
let majorPath: string;

afterEach(() => {
    if (majorPath !== undefined) {
        rmSync(majorPath, { force: true });
    }
});

describe("parseAppidFromMajor", () => {
    it("提取 QQAppId/ 后纯数字串", () => {
        majorPath = join(tmpdir(), `major-${Date.now()}-${Math.random()}.node`);
        writeFileSync(majorPath, Buffer.from("...QQAppId/537376818\x00..."));
        expect(parseAppidFromMajor(majorPath)).toBe("537376818");
    });

    it("多个标记取第一个纯数字", () => {
        majorPath = join(tmpdir(), `major-${Date.now()}-${Math.random()}.node`);
        writeFileSync(majorPath, Buffer.from("QQAppId/abc\x00QQAppId/12345\x00QQAppId/678\x00"));
        expect(parseAppidFromMajor(majorPath)).toBe("12345");
    });

    it("文件不存在返回 null", () => {
        expect(parseAppidFromMajor(join(tmpdir(), "no-such-major.node"))).toBeNull();
    });

    it("无 QQAppId/ 标记返回 null", () => {
        majorPath = join(tmpdir(), `major-${Date.now()}-${Math.random()}.node`);
        writeFileSync(majorPath, Buffer.from("no marker here"));
        expect(parseAppidFromMajor(majorPath)).toBeNull();
    });
});

describe("resolveAppidQua", () => {
    it("major 解析成功返回 appid 与 qua", () => {
        majorPath = join(tmpdir(), `major-${Date.now()}-${Math.random()}.node`);
        writeFileSync(majorPath, Buffer.from("QQAppId/537376818\x00"));
        const result = resolveAppidQua("9.9.33-51802", majorPath);
        expect(result.appid).toBe("537376818");
        expect(result.qua).toContain("9.9.33-51802");
    });

    it("major 解析失败回退硬编码表", () => {
        const result = resolveAppidQua("9.9.31-49919", undefined);
        expect(result.appid).toBe("537237765");
        expect(result.qua).toContain("9.9.31-49919");
    });
});
