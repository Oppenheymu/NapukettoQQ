/**
 * locate-qq.test.ts：QQ 安装定位纯函数单测。
 *
 * 只测纯逻辑：wslMappedPath（WSL 盘符挂载映射）与 resolveQqInstall 的
 * installDir 切分（dirname 跨平台，2026-08-13 修复：lastIndexOf("\\")
 * 在 Linux 正斜杠路径下返回 -1，slice(0,-1) 切错字符）。
 * 不依赖真实 QQ 安装（resolveQqInstall 需 existsSync 真实文件系统，
 * 这里只测切分语义——通过临时目录构造最小 versions 结构）。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveQqInstall, wslMappedPath } from "./locate-qq.js";

/** 临时安装目录（每个测试独立，测后清理）。 */
const tmpDirs: string[] = [];

/** 构造最小 QQ 安装结构：<root>/QQ.exe + <root>/versions/<v>/resources/app/wrapper.node。 */
function makeFakeInstall(): { root: string; version: string } {
    const root = mkdtempSync(join(tmpdir(), "napuketto-qq-"));
    tmpDirs.push(root);
    const version = "9.9.33-51802";
    const wrapperDir = join(root, "versions", version, "resources", "app");
    mkdirSync(wrapperDir, { recursive: true });
    writeFileSync(join(wrapperDir, "wrapper.node"), "");
    writeFileSync(join(root, "QQ.exe"), "");
    return { root, version };
}

afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
        // 测试临时目录，直接递归删除（仅限 os.tmpdir 下自建目录）
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        void import("node:fs/promises").then(({ rm }) => rm(dir, { recursive: true, force: true }));
    }
});

describe("wslMappedPath", () => {
    it("linux：C:/ 映射 /mnt/c/（正斜杠）", () => {
        expect(wslMappedPath("C:/Program Files/Tencent/QQNT/QQ.exe", "linux")).toBe(
            "/mnt/c/Program Files/Tencent/QQNT/QQ.exe",
        );
    });

    it("linux：C:\\ 映射 /mnt/c/（反斜杠）", () => {
        expect(wslMappedPath("C:\\Dev\\QQBot-Dev\\QQNT\\QQ.exe", "linux")).toBe(
            "/mnt/c/Dev/QQBot-Dev/QQNT/QQ.exe",
        );
    });

    it("linux：盘符转小写", () => {
        expect(wslMappedPath("D:/x/QQ.exe", "linux")).toBe("/mnt/d/x/QQ.exe");
    });

    it("linux：非盘符路径原样（Linux 本地路径）", () => {
        expect(wslMappedPath("/home/user/QQ.exe", "linux")).toBe("/home/user/QQ.exe");
    });

    it("win32：原样（不做映射）", () => {
        expect(wslMappedPath("C:/Program Files/Tencent/QQNT/QQ.exe", "win32")).toBe(
            "C:/Program Files/Tencent/QQNT/QQ.exe",
        );
    });
});

describe("resolveQqInstall", () => {
    it("installDir = dirname(qqPath)（正斜杠 Windows 路径）", () => {
        const { root, version } = makeFakeInstall();
        const info = resolveQqInstall(`${root}/QQ.exe`);
        expect(info.installDir).toBe(root);
        expect(info.version).toBe(version);
        expect(info.wrapperPath).toBe(
            join(root, "versions", version, "resources", "app", "wrapper.node"),
        );
        expect(info.source).toBe("local");
    });

    it("installDir = dirname(qqPath)（反斜杠 Windows 路径）", () => {
        const { root, version } = makeFakeInstall();
        const info = resolveQqInstall(`${root}\\QQ.exe`);
        expect(info.installDir).toBe(root);
        expect(info.version).toBe(version);
    });
});
