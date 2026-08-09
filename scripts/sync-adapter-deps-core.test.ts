/**
 * sync-adapter-deps-core.test.ts：核心纯函数单测。
 */
import { describe, expect, it } from "vitest";
import {
    latestFromDistTags,
    planSync,
    TRACKED_PACKAGES,
    tildeRange,
} from "./sync-adapter-deps-core.ts";

describe("tildeRange", () => {
    it("已是目标 tilde 范围 → 返回 null（幂等，不触发改写）", () => {
        expect(tildeRange("~0.0.6", "0.0.6")).toBeNull();
        expect(tildeRange("workspace:~0.0.6", "0.0.6")).toBeNull();
        expect(tildeRange("  ~0.0.6  ", "0.0.6")).toBeNull();
    });

    it("caret 范围 → 改写为 tilde", () => {
        expect(tildeRange("^0.0.3", "0.0.6")).toBe("~0.0.6");
    });

    it("精确版本 → 改写为 tilde", () => {
        expect(tildeRange("0.0.3", "0.0.6")).toBe("~0.0.6");
    });

    it("workspace 前缀 → 改写为 tilde（发布链时序：changeset 写 workspace 或 caret）", () => {
        expect(tildeRange("workspace:^0.0.3", "0.0.6")).toBe("~0.0.6");
        expect(tildeRange("workspace:*", "0.0.6")).toBe("~0.0.6");
    });

    it("旧 tilde 版本 → 改写为新 tilde", () => {
        expect(tildeRange("~0.0.3", "0.0.6")).toBe("~0.0.6");
    });

    it("缺省（未声明依赖）→ 返回目标 tilde", () => {
        expect(tildeRange(undefined, "0.0.6")).toBe("~0.0.6");
    });
});

describe("planSync", () => {
    it("全部最新 → 空变更集", () => {
        const deps = {
            "@napuketto/kernel": "~0.0.3",
            "@napuketto/loader": "~0.0.6",
        };
        const latest = { "@napuketto/kernel": "0.0.3", "@napuketto/loader": "0.0.6" };
        expect(planSync(deps, latest)).toEqual([]);
    });

    it("部分过期 → 只列过期项", () => {
        const deps = {
            "@napuketto/kernel": "^0.0.2",
            "@napuketto/loader": "~0.0.6",
        };
        const latest = { "@napuketto/kernel": "0.0.3", "@napuketto/loader": "0.0.6" };
        expect(planSync(deps, latest)).toEqual([
            { pkg: "@napuketto/kernel", from: "^0.0.2", to: "~0.0.3" },
        ]);
    });

    it("缺声明 → 标记 from (缺失)", () => {
        const deps = { "@napuketto/loader": "~0.0.6" };
        const latest = { "@napuketto/kernel": "0.0.3", "@napuketto/loader": "0.0.6" };
        expect(planSync(deps, latest)).toEqual([
            { pkg: "@napuketto/kernel", from: "(缺失)", to: "~0.0.3" },
        ]);
    });

    it("registry 缺包 → 抛错", () => {
        const deps = {};
        const latest = { "@napuketto/kernel": "0.0.3" };
        expect(() => planSync(deps, latest)).toThrow(/未返回 @napuketto\/loader/);
    });
});

describe("latestFromDistTags", () => {
    it("正常解析 latest", () => {
        expect(latestFromDistTags({ latest: "0.0.6", beta: "0.1.0-beta.1" })).toBe("0.0.6");
    });

    it("缺 latest → 抛错", () => {
        expect(() => latestFromDistTags({ beta: "0.1.0-beta.1" })).toThrow(/缺少 latest/);
    });

    it("latest 为空字符串 → 抛错", () => {
        expect(() => latestFromDistTags({ latest: "" })).toThrow(/缺少 latest/);
    });
});

describe("TRACKED_PACKAGES", () => {
    it("追踪 kernel 与 loader", () => {
        expect(TRACKED_PACKAGES).toEqual(["@napuketto/kernel", "@napuketto/loader"]);
    });
});
