/**
 * ipc-actions.test.ts：IPC 动作表单测（mock kernel apis，不依赖真实 wrapper）。
 */
import { describe, expect, it, vi } from "vitest";
import { callIpcAction, createIpcActions, type IpcApiContext } from "./ipc-actions.js";

/** mock kernel apis 上下文。 */
function mockCtx(): IpcApiContext {
    return {
        msgApi: {
            sendMessage: vi.fn(async () => ({ msgId: "42" })),
            recallMessage: vi.fn(async () => undefined),
            fetchMessages: vi.fn(async () => [{ msgId: "1" }]),
            markRead: vi.fn(async () => undefined),
        },
        groupApi: {
            getGroupList: vi.fn(async () => []),
        },
        groupCache: {
            listGroupsRefreshed: vi.fn(async () => [{ groupCode: "10001", groupName: "测试群" }]),
        },
        friendApi: {
            getFriendList: vi.fn(async () => [{ uid: "u1" }]),
        },
        self: { uin: "10001", nickname: "测试号" },
        uinToUid: vi.fn(async (uins: string[]) => {
            const map = new Map<string, string>();
            for (const uin of uins) {
                map.set(uin, `u_${uin}`);
            }
            return map;
        }),
    };
}

describe("createIpcActions", () => {
    it("login.getSelf 返回自身信息", async () => {
        const actions = createIpcActions(mockCtx());
        const result = await callIpcAction(actions, "login.getSelf", undefined);
        expect(result).toEqual({ ok: true, value: { uin: "10001", nickname: "测试号" } });
    });

    it("msg.sendMessage 透传 peer/elements 并返回 msgId", async () => {
        const ctx = mockCtx();
        const actions = createIpcActions(ctx);
        const result = await callIpcAction(actions, "msg.sendMessage", {
            chatType: 2,
            peerUin: "12345",
            elements: [{ type: "text", text: "你好" }],
        });
        expect(result).toEqual({ ok: true, value: { msgId: "42" } });
        expect(ctx.msgApi.sendMessage).toHaveBeenCalledWith({ chatType: 2, peerUid: "u_12345" }, [
            { type: "text", text: "你好" },
        ]);
    });

    it("msg.recallMessage 透传 msgIds", async () => {
        const ctx = mockCtx();
        const actions = createIpcActions(ctx);
        const result = await callIpcAction(actions, "msg.recallMessage", {
            chatType: 1,
            peerUin: "12345",
            msgIds: ["a", "b"],
        });
        expect(result).toEqual({ ok: true });
        expect(ctx.msgApi.recallMessage).toHaveBeenCalledWith({ chatType: 1, peerUid: "u_12345" }, [
            "a",
            "b",
        ]);
    });

    it("缺 peerUid/peerUin → 错误（提示可注入 uinToUid）", async () => {
        const actions = createIpcActions(mockCtx());
        const result = await callIpcAction(actions, "msg.sendMessage", {
            chatType: 1,
            peerUin: "",
            elements: [],
        });
        expect(result).toEqual({
            ok: false,
            error: { code: "UNKNOWN", message: "缺 peerUid（或 peerUin 且未注入 uinToUid）" },
        });
    });

    it("未知动作 → NOT_FOUND", async () => {
        const actions = createIpcActions(mockCtx());
        const result = await callIpcAction(actions, "nope.doSomething", {});
        expect(result).toEqual({
            ok: false,
            error: { code: "NOT_FOUND", message: "未知动作: nope.doSomething" },
        });
    });

    it("动作抛带 code 的错误 → code 透传（KernelError 契约）", async () => {
        const ctx = mockCtx();
        const { msgApi } = ctx;
        msgApi.sendMessage = vi.fn(async () => {
            const err = new Error("消息不存在") as Error & { code: string };
            err.code = "NOT_FOUND";
            throw err;
        });
        const actions = createIpcActions(ctx);
        const result = await callIpcAction(actions, "msg.sendMessage", {
            chatType: 1,
            peerUid: "u_12345",
            elements: [],
        });
        expect(result).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "消息不存在" } });
    });

    it("动作抛普通 Error → UNKNOWN", async () => {
        const ctx = mockCtx();
        ctx.msgApi.sendMessage = vi.fn(async () => {
            throw new Error("boom");
        });
        const actions = createIpcActions(ctx);
        const result = await callIpcAction(actions, "msg.sendMessage", {
            chatType: 1,
            peerUid: "u_12345",
            elements: [],
        });
        expect(result).toEqual({ ok: false, error: { code: "UNKNOWN", message: "boom" } });
    });

    it("msg.fetchMessages 缺省 count=20，msgId 可选", async () => {
        const ctx = mockCtx();
        const actions = createIpcActions(ctx);
        const result = await callIpcAction(actions, "msg.fetchMessages", {
            chatType: 1,
            peerUid: "u_12345",
        });
        expect(result).toEqual({ ok: true, value: [{ msgId: "1" }] });
        expect(ctx.msgApi.fetchMessages).toHaveBeenCalledWith(
            { chatType: 1, peerUid: "u_12345" },
            { count: 20 },
        );
    });

    it("group.getGroupList 经 listGroupsRefreshed 取（空缓存自动刷新回填）", async () => {
        const ctx = mockCtx();
        const actions = createIpcActions(ctx);
        const result = await callIpcAction(actions, "group.getGroupList", {});
        expect(result).toEqual({
            ok: true,
            value: [{ groupCode: "10001", groupName: "测试群" }],
        });
        expect(ctx.groupCache.listGroupsRefreshed).toHaveBeenCalled();
    });
});
