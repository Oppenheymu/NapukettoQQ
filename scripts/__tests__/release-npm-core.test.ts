/**
 * release-npm-core.test.ts：发布链核心逻辑单测（临时目录模拟工作区）。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverPackages, planPublish, topoSort, type WorkspacePkg } from "../release-npm-core.ts";

let tmpRoot: string;

beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "napuketto-release-test-"));
});

afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
});

/** 在临时根目录下写入一个包，返回其 WorkspacePkg。 */
async function writePkg(
    relDir: string,
    name: string,
    deps: Record<string, string> = {},
    options: { isPrivate?: boolean } = {},
): Promise<WorkspacePkg> {
    const dir = join(tmpRoot, relDir);
    await mkdir(dir, { recursive: true });
    const pkg = {
        name,
        version: "0.0.1",
        ...(options.isPrivate === true ? { private: true } : {}),
        dependencies: deps,
    };
    await writeFile(join(dir, "package.json"), JSON.stringify(pkg, null, 4), "utf8");
    return { name, dir, version: "0.0.1", dependencies: deps };
}

describe("discoverPackages", () => {
    it("发现 packages/* 与 apps/* 下的包", async () => {
        await writePkg("packages/kernel", "@napuketto/kernel");
        await writePkg("packages/media", "@napuketto/media");
        await writePkg("apps/cli", "@napuketto/cli");
        const pkgs = await discoverPackages(tmpRoot);
        const names = pkgs.map((p) => p.name).sort();
        expect(names).toEqual(["@napuketto/cli", "@napuketto/kernel", "@napuketto/media"]);
    });

    it("排除 private 包与无 package.json 的目录", async () => {
        await writePkg("packages/kernel", "@napuketto/kernel");
        await writePkg("packages/secret", "secret", {}, { isPrivate: true });
        await mkdir(join(tmpRoot, "packages", "empty"), { recursive: true });
        const pkgs = await discoverPackages(tmpRoot);
        expect(pkgs.map((p) => p.name)).toEqual(["@napuketto/kernel"]);
    });
});

describe("topoSort", () => {
    it("依赖链：被依赖者在前", () => {
        const kernel: WorkspacePkg = {
            name: "@napuketto/kernel",
            dir: "packages/kernel",
            version: "0.0.1",
            dependencies: {},
        };
        const media: WorkspacePkg = {
            name: "@napuketto/media",
            dir: "packages/media",
            version: "0.0.1",
            dependencies: {},
        };
        const adapter: WorkspacePkg = {
            name: "@napuketto/adapter",
            dir: "packages/adapter",
            version: "0.0.1",
            dependencies: {
                "@napuketto/kernel": "workspace:*",
                "@napuketto/media": "workspace:*",
            },
        };
        const cli: WorkspacePkg = {
            name: "@napuketto/cli",
            dir: "apps/cli",
            version: "0.0.1",
            dependencies: {
                "@napuketto/kernel": "workspace:*",
                "@napuketto/adapter": "workspace:*",
            },
        };
        const ordered = topoSort([cli, adapter, kernel, media]).map((p) => p.name);
        const pos = (name: string) => ordered.indexOf(name);
        expect(pos("@napuketto/kernel")).toBeLessThan(pos("@napuketto/adapter"));
        expect(pos("@napuketto/media")).toBeLessThan(pos("@napuketto/adapter"));
        expect(pos("@napuketto/adapter")).toBeLessThan(pos("@napuketto/cli"));
    });

    it("外部依赖不影响顺序", () => {
        const a: WorkspacePkg = {
            name: "a",
            dir: "a",
            version: "0.0.1",
            dependencies: { lodash: "^4.0.0" },
        };
        const b: WorkspacePkg = {
            name: "b",
            dir: "b",
            version: "0.0.1",
            dependencies: { react: "^18.0.0" },
        };
        expect(topoSort([a, b]).map((p) => p.name)).toEqual(["a", "b"]);
    });

    it("koishi 适配器的 tilde 范围同样命中内部依赖", () => {
        const kernel: WorkspacePkg = {
            name: "@napuketto/kernel",
            dir: "packages/kernel",
            version: "0.0.1",
            dependencies: {},
        };
        const koishi: WorkspacePkg = {
            name: "koishi-plugin-adapter-napuketto",
            dir: "apps/koishi-plugin-adapter",
            version: "0.0.1",
            dependencies: { "@napuketto/kernel": "~0.0.6" },
        };
        const ordered = topoSort([koishi, kernel]).map((p) => p.name);
        expect(ordered).toEqual(["@napuketto/kernel", "koishi-plugin-adapter-napuketto"]);
    });

    it("存在环 → 抛错", () => {
        const a: WorkspacePkg = {
            name: "a",
            dir: "a",
            version: "0.0.1",
            dependencies: { b: "workspace:*" },
        };
        const b: WorkspacePkg = {
            name: "b",
            dir: "b",
            version: "0.0.1",
            dependencies: { a: "workspace:*" },
        };
        expect(() => topoSort([a, b])).toThrow(/环/);
    });
});

describe("planPublish", () => {
    const mk = (name: string, version: string): WorkspacePkg => ({
        name,
        dir: name,
        version,
        dependencies: {},
    });

    it("版本已存在于 registry → 跳过；新版本 → 发布", () => {
        const pkgs = [mk("@napuketto/media", "0.0.1"), mk("@napuketto/adapter", "0.0.8")];
        const published = new Map([
            ["@napuketto/media", new Set(["0.0.1"])],
            ["@napuketto/adapter", new Set(["0.0.7"])],
        ]);
        const { toPublish, skipped } = planPublish(pkgs, published);
        expect(toPublish.map((p) => p.name)).toEqual(["@napuketto/adapter"]);
        expect(skipped.map((s) => s.pkg.name)).toEqual(["@napuketto/media"]);
        expect(skipped[0]?.reason).toContain("已在 registry");
    });

    it("registry 为空集（包从未发布）→ 全部发布", () => {
        const pkgs = [mk("@napuketto/brand-new", "0.0.1")];
        const { toPublish, skipped } = planPublish(
            pkgs,
            new Map([["@napuketto/brand-new", new Set()]]),
        );
        expect(toPublish.map((p) => p.name)).toEqual(["@napuketto/brand-new"]);
        expect(skipped).toEqual([]);
    });

    it("缺少 registry 版本信息 → 抛错（发布前必须查询）", () => {
        const pkgs = [mk("a", "0.0.1")];
        expect(() => planPublish(pkgs, new Map())).toThrow(/registry 版本信息/);
    });
});
