/**
 * msg-log.test.ts：消息日志 colorize 选择单测（2026-09-06 IPC 文件日志 ANSI 污染修复）。
 *
 * setupMsgLogging 的 colorize 参数：true 时 logger 落彩色串（cli 终端，2026-08-07
 * 用户定稿），false 时落 plain（IPC 模式 logger 是纯文件 JSON 日志，ANSI 转义会
 * 污染 JSON 行）。env.ts 是模块加载时的 process.env 快照——NAPUTO_CFG_DIR 指向
 * 临时目录使 log() 落盘无污染，与 bootstrap.test.ts 同套路。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { EventChannelLike, KernelLike, LoggerLike } from "../types.js";

/** 计算键规避 useNamingConvention（kernel 常量成员名 ChatType 为 PascalCase）。 */
const CHAT_TYPE = "ChatType";

let tmpRoot = "";
let emit: ((payload: unknown) => void) | undefined;
const coloredInfos: unknown[] = [];
const plainInfos: unknown[] = [];

function stubKernel(): KernelLike {
    return {
        [CHAT_TYPE]: { GROUP: 1, C2C: 2 },
        toCanonicalElements: (msg: unknown) => {
            const raw = msg as { elements?: unknown };
            return (Array.isArray(raw.elements) ? raw.elements : []) as never[];
        },
    } as unknown as KernelLike;
}

function stubLogger(sink: unknown[]): LoggerLike {
    return {
        info: (obj) => sink.push(obj),
        warn: (obj) => sink.push(obj),
        error: (obj) => sink.push(obj),
    };
}

function groupMsg(): unknown {
    return {
        chatType: 1,
        peerUin: "100",
        senderUin: "200",
        elements: [{ type: "text", text: "hi" }],
    };
}

/** 触发一次 onRecvMsg 并断言两个 sink 各收到一条。 */
function recvOnce(): void {
    coloredInfos.length = 0;
    plainInfos.length = 0;
    emit?.(groupMsg());
    expect(coloredInfos).toHaveLength(1);
    expect(plainInfos).toHaveLength(1);
}

beforeAll(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "napuketto-msglog-test-"));
    vi.stubEnv("NAPUTO_CFG_DIR", tmpRoot);
    const { setupMsgLogging } = await import("../msg-log.js");
    const kernel = stubKernel();
    const handlers: ((payload: unknown) => void)[] = [];
    const channel: EventChannelLike = {
        on: (_event, h) => {
            handlers.push(h);
            return undefined;
        },
    };
    setupMsgLogging(kernel, channel, stubLogger(coloredInfos), true);
    setupMsgLogging(kernel, channel, stubLogger(plainInfos), false);
    emit = (payload) => {
        for (const h of handlers) {
            h(payload);
        }
    };
});

afterAll(() => {
    if (tmpRoot !== "") {
        rmSync(tmpRoot, { recursive: true, force: true });
    }
});

describe("setupMsgLogging colorize 选择", () => {
    it("colorize=true 落彩色串（含 ANSI 转义，cli 终端行为）", () => {
        recvOnce();
        const line = coloredInfos[0] as string;
        expect(line).toContain("\u001b[90mloader | 接收 <- 群聊");
        expect(line).toContain("\u001b[36m[群100]\u001b[0m");
        expect(line).toContain("\u001b[32m[用户200]\u001b[0m");
    });

    it("colorize=false 落 plain（无 ANSI 转义，IPC 文件 JSON 日志可读）", () => {
        recvOnce();
        const line = plainInfos[0] as string;
        expect(line).toBe("接收 <- 群聊 [群100] [用户200]： hi");
        expect(line).not.toContain("\u001b");
    });
});
