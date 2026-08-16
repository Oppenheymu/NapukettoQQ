/**
 * release-npm-core.test.ts：workspace:* 改写（发布前依赖范围修复）单测。
 *
 * 背景（2026-08-16）：发布环节曾绕过 changeset 直发，published 包泄漏
 * workspace:*，yarn create / npm install 被迫交互选版本或直接失败。
 * rewriteWorkspaceProtocol 是修复核心（幂等、纯函数），本测试覆盖
 * 改写 / 幂等 / 未知包报错三路径。
 */
import { describe, expect, it } from "vitest";
import { rewriteWorkspaceProtocol } from "./release-npm-core.ts";

/** 构造带依赖的 package.json 文本（4 空格缩进，与仓库一致）。 */
function pkgJson(deps: Record<string, string>): string {
    return `{
    "name": "test-pkg",
    "version": "0.0.1",
    "dependencies": ${JSON.stringify(deps, null, 4)}
}
`;
}

describe("rewriteWorkspaceProtocol", () => {
    const versions = new Map([
        ["@napuketto/kernel", "0.0.10"],
        ["@napuketto/cli", "0.0.20"],
    ]);

    it("把 dependencies 中的 workspace:* 改写为 caret 真实版本", () => {
        const raw = pkgJson({ "@napuketto/kernel": "workspace:*", commander: "^15.0.0" });
        const { text, changes } = rewriteWorkspaceProtocol(raw, versions);
        expect(changes).toEqual([
            { field: "dependencies", dep: "@napuketto/kernel", range: "^0.0.10" },
        ]);
        const parsed = JSON.parse(text) as { dependencies: Record<string, string> };
        expect(parsed.dependencies["@napuketto/kernel"]).toBe("^0.0.10");
        // 非 workspace:* 依赖原样保留
        expect(parsed.dependencies["commander"]).toBe("^15.0.0");
    });

    it("覆盖全部依赖字段（dev/optional/peer）", () => {
        const raw = JSON.stringify(
            {
                name: "test",
                version: "0.0.1",
                dependencies: { "@napuketto/cli": "workspace:*" },
                devDependencies: { "@napuketto/kernel": "workspace:*" },
                optionalDependencies: { "opt-pkg": "workspace:*" },
                peerDependencies: { "peer-pkg": "workspace:*" },
            },
            null,
            4,
        );
        const allVersions = new Map([...versions, ["opt-pkg", "0.1.0"], ["peer-pkg", "0.2.0"]]);
        const { changes } = rewriteWorkspaceProtocol(raw, allVersions);
        expect(changes.map((c) => c.dep).sort()).toEqual([
            "@napuketto/cli",
            "@napuketto/kernel",
            "opt-pkg",
            "peer-pkg",
        ]);
        // 各字段均改写为 caret 真实版本
        const parsed = JSON.parse(rewriteWorkspaceProtocol(raw, allVersions).text) as Record<
            string,
            Record<string, string>
        >;
        expect(parsed["dependencies"]?.["@napuketto/cli"]).toBe("^0.0.20");
        expect(parsed["devDependencies"]?.["@napuketto/kernel"]).toBe("^0.0.10");
        expect(parsed["optionalDependencies"]?.["opt-pkg"]).toBe("^0.1.0");
        expect(parsed["peerDependencies"]?.["peer-pkg"]).toBe("^0.2.0");
    });

    it("无 workspace:* 时原样返回（幂等，不重排）", () => {
        const raw = pkgJson({ commander: "^15.0.0" });
        const { text, changes } = rewriteWorkspaceProtocol(raw, versions);
        expect(changes).toEqual([]);
        expect(text).toBe(raw);
    });

    it("工作区找不到的 workspace:* 依赖抛错（发布链中断）", () => {
        const raw = pkgJson({ "@napuketto/unknown": "workspace:*" });
        expect(() => rewriteWorkspaceProtocol(raw, versions)).toThrow(/工作区内找不到该包版本/);
    });
});
