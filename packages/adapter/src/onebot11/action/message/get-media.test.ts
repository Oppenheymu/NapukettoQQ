/**
 * get-media.test.ts：get_image / get_record 单测（2026-09-08 T5 主动下载接入）。
 *
 * 覆盖：NT 相对路径本地解析（mediaBaseDir 命中/未命中）、图片 URL 主动下载
 * （fetch 桩 + cacheDir 落盘）、下载失败回退 url-only、语音本地命中/原始路径透出。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RawMessage } from "@napuketto/kernel";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageUnique } from "../../helper/message-unique.js";
import { GetImageAction, GetRecordAction, resolveLocalMediaFile } from "./get-media.js";

/** 桩依赖（msgApi.fetchMsgsByMsgId 可控返回）。 */
function makeDeps(msg: RawMessage | null, extra: { mediaBaseDir?: string; cacheDir?: string }) {
    const messageUnique = new MessageUnique();
    messageUnique.alloc(msg?.msgId ?? "m1", { chatType: 1, peerUid: "u1" });
    return {
        messageUnique,
        cacheDir: extra.cacheDir,
        mediaBaseDir: extra.mediaBaseDir,
        msgApi: {
            fetchMsgsByMsgId: vi.fn(async () => (msg === null ? [] : [msg])),
        },
    } as unknown as ConstructorParameters<typeof GetImageAction>[0];
}

/** 图片消息工厂。 */
function picMsg(pic: Record<string, unknown>): RawMessage {
    return {
        msgId: "m1",
        msgSeq: "1",
        msgTime: "1700000000000",
        msgType: 2,
        chatType: 1,
        peerUid: "u1",
        peerUin: "10000",
        senderUid: "u1",
        senderUin: "10000",
        peerName: "",
        sendNickName: "",
        elements: [{ elementType: 2, picElement: pic }],
    } as unknown as RawMessage;
}

const dirs: string[] = [];

function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), `napuketto-${prefix}-`));
    dirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
    vi.unstubAllGlobals();
});

describe("resolveLocalMediaFile", () => {
    it("绝对路径存在直接返回；相对路径按 mediaBaseDir 拼接（反斜杠归一化）", () => {
        const base = tempDir("base");
        const rel = join(base, "nt_data", "Pic", "a.jpg").replaceAll("\\", "/");
        mkdirSync(join(base, "nt_data", "Pic"), { recursive: true });
        writeFileSync(rel, "x");
        expect(resolveLocalMediaFile(rel, { mediaBaseDir: base })).toBe(rel);
        expect(resolveLocalMediaFile("nt_data\\Pic\\a.jpg", { mediaBaseDir: base })).toContain(
            "a.jpg",
        );
    });

    it("未命中返回 null", () => {
        expect(resolveLocalMediaFile("nt_data/nope.jpg", { mediaBaseDir: "C:/nope" })).toBeNull();
        expect(resolveLocalMediaFile("", {})).toBeNull();
    });
});

describe("GetImageAction", () => {
    it("本地命中（sourcePath 按 mediaBaseDir 解析）→ file 绝对路径", async () => {
        const base = tempDir("img");
        const file = join(base, "nt_data/Pic/x.jpg").replaceAll("\\", "/");
        mkdirSync(join(base, "nt_data", "Pic"), { recursive: true });
        writeFileSync(file, "x");
        const deps = makeDeps(
            picMsg({ sourcePath: "nt_data/Pic/x.jpg", fileName: "x.jpg", fileSize: "1" }),
            { mediaBaseDir: base },
        );
        const result = (await new GetImageAction(deps).handle({ message_id: 1 })).data;
        expect(result?.file?.replaceAll("\\", "/")).toBe(file);
        expect(result?.file_name).toBe("x.jpg");
    });

    it("本地未命中 + picUrl → 主动下载到 cacheDir/media（fetch 桩）", async () => {
        const cache = tempDir("cache");
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
        );
        const deps = makeDeps(
            picMsg({ sourcePath: "nt_data/Pic/remote.jpg", picUrl: "https://x/img.jpg" }),
            { mediaBaseDir: tempDir("base2"), cacheDir: cache },
        );
        const result = (await new GetImageAction(deps).handle({ message_id: 1 })).data;
        expect(result?.url).toBe("https://x/img.jpg");
        expect(result?.file).toBeDefined();
        expect(existsSync(result?.file as string)).toBe(true);
    });

    it("下载失败（非 2xx）→ 仅 url，不抛错", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("x", { status: 500 })),
        );
        const deps = makeDeps(picMsg({ picUrl: "https://x/img.jpg" }), {
            cacheDir: tempDir("cache2"),
        });
        const result = (await new GetImageAction(deps).handle({ message_id: 1 })).data;
        expect(result?.url).toBe("https://x/img.jpg");
        expect(result?.file).toBeUndefined();
    });
});

describe("GetRecordAction", () => {
    it("本地命中 → file 绝对路径；未命中 → 原始 filePath 透出（语音下载缺口）", async () => {
        const base = tempDir("voice");
        mkdirSync(join(base, "nt_data", "Ptt"), { recursive: true });
        writeFileSync(join(base, "nt_data/Ptt/1.silk").replaceAll("\\", "/"), "silk");
        const hit = (
            await new GetRecordAction(
                makeDeps(
                    {
                        ...(picMsg({}) as object),
                        elements: [
                            { elementType: 4, pttElement: { filePath: "nt_data/Ptt/1.silk" } },
                        ],
                    } as unknown as RawMessage,
                    { mediaBaseDir: base },
                ),
            ).handle({ message_id: 1 })
        ).data;
        expect(hit?.file).toContain("1.silk");

        const miss = (
            await new GetRecordAction(
                makeDeps(
                    {
                        ...(picMsg({}) as object),
                        elements: [
                            { elementType: 4, pttElement: { filePath: "nt_data/Ptt/gone.silk" } },
                        ],
                    } as unknown as RawMessage,
                    { mediaBaseDir: base },
                ),
            ).handle({ message_id: 1 })
        ).data;
        expect(miss?.file).toBe("nt_data/Ptt/gone.silk");
    });
});
