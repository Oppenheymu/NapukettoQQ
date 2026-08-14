/**
 * wine.test.ts：P2 纯函数单测（toWinePath / buildSpawnCommand / wineBinary）。
 * 不依赖真实 wine——纯逻辑层，Windows 上即可验证（P2 分层策略）。
 */
import { describe, expect, it } from "vitest";
import { buildSpawnCommand, toWinePath, unixPathToWinePath, wineBinary } from "../wine.js";

describe("toWinePath", () => {
    it("Linux 绝对路径转 Z: 反斜杠路径", () => {
        expect(toWinePath("/app/.napuketto/qq-files/9.9.33/wrapper.node")).toBe(
            "Z:\\app\\.napuketto\\qq-files\\9.9.33\\wrapper.node",
        );
    });

    it("根路径", () => {
        expect(toWinePath("/")).toBe("Z:\\");
    });

    it("去除多余前导斜杠（避免 Z:\\ 双反斜杠）", () => {
        expect(toWinePath("/usr/local/bin")).toBe("Z:\\usr\\local\\bin");
    });

    it("不含前导斜杠的相对路径原样转", () => {
        expect(toWinePath("relative/path")).toBe("Z:\\relative\\path");
    });

    it("Windows 风格路径不再加前缀（幂等）", () => {
        // 已是 Z: 形式则保持（调用方不应传这种，但幂等保护）
        expect(toWinePath("Z:\\app\\x")).toBe("Z:\\app\\x");
    });
});

describe("buildSpawnCommand", () => {
    it("win32 用本机 node + selfHostPath", () => {
        const cmd = buildSpawnCommand({
            platform: "win32",
            winNodePath: "C:\\node.exe",
            selfHostPath: "C:\\s.cjs",
        });
        expect(cmd).toEqual({ command: "C:\\node.exe", args: ["C:\\s.cjs"] });
    });

    it("linux 用 wine + winNodePath + selfHostPath", () => {
        const cmd = buildSpawnCommand({
            platform: "linux",
            winNodePath: "/w/node.exe",
            selfHostPath: "/s.cjs",
        });
        expect(cmd).toEqual({ command: "wine", args: ["/w/node.exe", "/s.cjs"] });
    });

    it("linux 自定义 wine 命令（NAPUTO_WINE 覆盖）", () => {
        const cmd = buildSpawnCommand({
            platform: "linux",
            wine: "/opt/wine/bin/wine",
            winNodePath: "/w/node.exe",
            selfHostPath: "/s.cjs",
        });
        expect(cmd.command).toBe("/opt/wine/bin/wine");
    });
});

describe("unixPathToWinePath", () => {
    it("Unix PATH（冒号分隔）转 wine Windows PATH（分号分隔 + Z:\\ 条目）", () => {
        expect(unixPathToWinePath("/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin")).toBe(
            "Z:\\usr\\local\\sbin;Z:\\usr\\local\\bin;Z:\\usr\\sbin;Z:\\usr\\bin",
        );
    });

    it("过滤空条目（连续冒号 / 尾部冒号）", () => {
        expect(unixPathToWinePath("/usr/bin::/bin:")).toBe("Z:\\usr\\bin;Z:\\bin");
    });

    it("空 PATH 返回空串", () => {
        expect(unixPathToWinePath("")).toBe("");
    });
});

describe("wineBinary", () => {
    it("缺省 wine（无环境变量时）", () => {
        const prev = process.env["NAPUTO_WINE"];
        delete process.env["NAPUTO_WINE"];
        try {
            expect(wineBinary()).toBe("wine");
        } finally {
            if (prev !== undefined) process.env["NAPUTO_WINE"] = prev;
        }
    });
});
