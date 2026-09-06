/**
 * ipc-sender.test.ts：sendStatus 快照 + replayStatus 重播单测。
 *
 * enabled / lastStatus 是模块级状态——vi.resetModules + 动态 import 每用例
 * 取全新模块，避免串扰；stdout 用 spy 拦截（enable 后真实写会污染测试输出）。
 */
import { describe, expect, it, vi } from "vitest";

/** 取全新 ipc-sender 模块（隔离模块级 enabled / lastStatus 状态）。 */
async function freshSender(): Promise<typeof import("../ipc-sender.js")> {
    vi.resetModules();
    return await import("../ipc-sender.js");
}

/** 拦截 stdout 写并按行收集（返回收集数组）。 */
function captureStdout(): string[] {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        lines.push(String(chunk));
        return true;
    });
    return lines;
}

describe("ipc-sender status 快照与重播", () => {
    it("未 enable（非 IPC 模式）不写 stdout", async () => {
        const sender = await freshSender();
        const lines = captureStdout();
        try {
            sender.sendStatus("ready");
            sender.replayStatus();
            expect(lines).toHaveLength(0);
        } finally {
            vi.restoreAllMocks();
        }
    });

    it("sendStatus 写 JSON 行，replayStatus 重播同一条", async () => {
        const sender = await freshSender();
        const lines = captureStdout();
        try {
            sender.enableIpc();
            sender.sendStatus("ready");
            expect(lines).toHaveLength(1);
            sender.replayStatus();
            expect(lines).toHaveLength(2);
            expect(lines[1]).toBe(lines[0]);
            // 内容正确：JSON 行协议（v=1 + type=status + payload.phase）
            expect(JSON.parse(lines[0] as string)).toEqual({
                v: 1,
                type: "status",
                payload: { phase: "ready" },
            });
        } finally {
            vi.restoreAllMocks();
        }
    });

    it("从未发送 status 时 replayStatus 不写", async () => {
        const sender = await freshSender();
        const lines = captureStdout();
        try {
            sender.enableIpc();
            sender.replayStatus();
            expect(lines).toHaveLength(0);
        } finally {
            vi.restoreAllMocks();
        }
    });

    it("快照随最新 status 更新（booting → ready 重播 ready）", async () => {
        const sender = await freshSender();
        const lines = captureStdout();
        try {
            sender.enableIpc();
            sender.sendStatus("booting");
            sender.sendStatus("ready");
            sender.replayStatus();
            expect(lines).toHaveLength(3);
            expect(JSON.parse(lines[2] as string)).toEqual({
                v: 1,
                type: "status",
                payload: { phase: "ready" },
            });
        } finally {
            vi.restoreAllMocks();
        }
    });

    it("failed 携带 message/error 时快照完整保留", async () => {
        const sender = await freshSender();
        const lines = captureStdout();
        try {
            sender.enableIpc();
            sender.sendStatus("failed", "登录失败", { code: "NOT_LOGIN", message: "登录失败" });
            sender.replayStatus();
            expect(JSON.parse(lines[1] as string)).toEqual({
                v: 1,
                type: "status",
                payload: {
                    phase: "failed",
                    message: "登录失败",
                    error: { code: "NOT_LOGIN", message: "登录失败" },
                },
            });
        } finally {
            vi.restoreAllMocks();
        }
    });
});
