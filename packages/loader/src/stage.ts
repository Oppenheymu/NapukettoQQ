/**
 * stage：把 wrapper.node 与其私有依赖复制到临时目录
 * （Node/Electron 的 DLL 搜索限制：wrapper.node 的依赖必须在同目录或已加载）
 *
 * 2026-08-05 实测：wrapper.node 依赖 libvips/libglib/libgobject/crypto/ssl/broadcast_ipc
 * （同目录）及 QQNT.dll/ffmpeg.dll（versions 根目录）。
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const WRAPPER_DEPS = [
    "libvips-42.dll",
    "libglib-2.0-0.dll",
    "libgobject-2.0-0.dll",
    "crypto.dll",
    "ssl.dll",
    "broadcast_ipc.dll",
];

const QQNT_DEPS = ["QQNT.dll", "ffmpeg.dll"];

export interface StageResult {
    dir: string;
    wrapperPath: string;
}

/**
 * 把 wrapper.node + 依赖复制到临时目录。
 * 注意：QQ.exe 用自己的 resources/app（实测会忽略自定义 app 路径），
 * 所以此 stage 仅用于我们的 hook DLL 需要加载的本地副本（如有）。
 */
export function stageWrapper(wrapperPath: string): StageResult {
    const dir = mkdtempSync(join(tmpdir(), "napuketto-stage-"));
    const appDir = dirname(wrapperPath); // .../resources/app
    const versionDir = dirname(dirname(appDir)); // .../versions/<version>

    const items: [string, string][] = [
        [wrapperPath, "wrapper.node"],
        ...WRAPPER_DEPS.map((n) => [join(appDir, n), n] as [string, string]),
        ...QQNT_DEPS.map((n) => [join(versionDir, n), n] as [string, string]),
    ];
    for (const [src, name] of items) {
        if (existsSync(src)) {
            copyFileSync(src, join(dir, name));
        }
    }
    return { dir, wrapperPath: join(dir, "wrapper.node") };
}

export function cleanupStage(stage: StageResult): void {
    try {
        rmSync(stage.dir, { recursive: true, force: true });
    } catch {
        // ignore
    }
}
