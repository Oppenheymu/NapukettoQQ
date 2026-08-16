/**
 * config-parse.test.ts：主配置手写校验器单测（占位 QQ 号护栏）。
 *
 * 覆盖 accounts.qq 校验：纯数字 5-11 位、拒绝模板占位值（123456 / 654321）、
 * 拒绝非数字 / 超长 / 过短。dataDir 显式传入，避免 resolveDataRoot 触发文件系统探测。
 */
import { describe, expect, it } from "vitest";
import { parseCliConfig } from "./config-parse.js";

/** 构造最小合法主配置（含单个账号，qq 由调用方指定）。 */
function configWithQq(qq: string): unknown {
    return {
        dataDir: ".napuketto",
        autoRestart: true,
        restartDelayMs: 2000,
        accounts: [{ qq }],
    };
}

describe("parseCliConfig accounts.qq 校验", () => {
    it("接受 5 位纯数字 QQ 号", () => {
        const config = parseCliConfig(configWithQq("10000"));
        expect(config.accounts[0]?.qq).toBe("10000");
    });

    it("接受 11 位纯数字 QQ 号", () => {
        const config = parseCliConfig(configWithQq("12345678901"));
        expect(config.accounts[0]?.qq).toBe("12345678901");
    });

    it("拒绝占位值 123456", () => {
        expect(() => parseCliConfig(configWithQq("123456"))).toThrow(/占位值/);
    });

    it("拒绝占位值 654321", () => {
        expect(() => parseCliConfig(configWithQq("654321"))).toThrow(/占位值/);
    });

    it("拒绝非纯数字", () => {
        expect(() => parseCliConfig(configWithQq("12a456"))).toThrow(/纯数字/);
    });

    it("拒绝超长（12 位）", () => {
        expect(() => parseCliConfig(configWithQq("123456789012"))).toThrow(/5-11 位/);
    });

    it("拒绝过短（4 位）", () => {
        expect(() => parseCliConfig(configWithQq("1234"))).toThrow(/5-11 位/);
    });
});
