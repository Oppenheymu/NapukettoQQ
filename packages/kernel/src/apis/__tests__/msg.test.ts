/**
 * msg.ts 基线测试（fallow 重构目标，untested risk）
 *
 * 覆盖 MsgApi 核心路径（mock session/service，不依赖真实 wrapper）：
 *  - constructor：getMsgService 空抛 INVALID_STATE
 *  - sendMessage / fetchMsgsByMsgId / fetchPttText / sendForwardMessage /
 *    fetchForwardMessage / recallMessage
 */
import { describe, expect, it, vi } from "vitest";
import { KernelError } from "../../infra/index.js";
import type { NodeIQQNTWrapperSession, Peer } from "../../types/index.js";
import { MsgApi } from "../msg.js";

const target: Peer = { chatType: 1, peerUid: "10001" };

/** 构造 MsgApi（mock msg service）。 */
function makeApi(overrides: Record<string, unknown> = {}) {
    const service = {
        generateMsgUniqueId: vi.fn(() => "msgid-1"),
        sendMsg: vi.fn(async () => ({ result: 0 })),
        recallMsg: vi.fn(async () => ({ result: 0 })),
        getMsgs: vi.fn(async () => ({ result: 0, msgList: [] })),
        getMsgsByMsgId: vi.fn(async () => ({ result: 0, msgList: [] })),
        translatePtt2Text: vi.fn(async () => ({ result: 0 })),
        buildMultiForwardMsg: vi.fn(async () => ({ result: 0, rspInfo: { elements: [] } })),
        getMultiMsg: vi.fn(async () => ({ result: 0, msgList: [] })),
        forwardMsg: vi.fn(async () => ({ result: 0 })),
        setMsgEmojiLikes: vi.fn(async () => ({ result: 0 })),
        setStatus: vi.fn(async () => ({ result: 0 })),
        ...overrides,
    };
    const session = { getMsgService: () => service } as unknown as NodeIQQNTWrapperSession;
    return { service, api: new MsgApi(session) };
}

describe("constructor", () => {
    it("getMsgService 空抛 INVALID_STATE", () => {
        const session = { getMsgService: () => null } as unknown as NodeIQQNTWrapperSession;
        expect(() => new MsgApi(session)).toThrow(/getMsgService\(\) 返回空/);
    });
});

describe("sendMessage", () => {
    it("成功返回 msgId", async () => {
        const { api } = makeApi();
        await expect(api.sendMessage(target, [{ type: "text", text: "hi" }])).resolves.toEqual({
            msgId: "msgid-1",
        });
    });

    it("原生失败抛 KernelError", async () => {
        const { api } = makeApi({ sendMsg: vi.fn(async () => ({ result: -1 })) });
        await expect(api.sendMessage(target, [])).rejects.toBeInstanceOf(KernelError);
    });
});

describe("recallMessage", () => {
    it("空 msgIds 抛 INVALID_PARAM", async () => {
        const { api } = makeApi();
        await expect(api.recallMessage(target, [])).rejects.toThrow(/至少一个 msgId/);
    });

    it("成功调用 recallMsg", async () => {
        const { api, service } = makeApi();
        await api.recallMessage(target, ["m1"]);
        expect(service.recallMsg).toHaveBeenCalledWith(target, ["m1"]);
    });
});

describe("fetchPttText", () => {
    it("消息含 ptt 且转写成功", async () => {
        const pttMsg = {
            msgId: "m1",
            elements: [{ pttElement: { text: "" } }],
        };
        const afterMsg = {
            msgId: "m1",
            elements: [{ pttElement: { text: "转写结果" } }],
        };
        const { api, service } = makeApi({
            getMsgsByMsgId: vi
                .fn()
                .mockResolvedValueOnce({ result: 0, msgList: [pttMsg] })
                .mockResolvedValueOnce({ result: 0, msgList: [afterMsg] }),
        });
        await expect(api.fetchPttText("m1", target)).resolves.toBe("转写结果");
        expect(service.translatePtt2Text).toHaveBeenCalled();
    });

    it("消息无 ptt 抛 NOT_FOUND", async () => {
        const { api } = makeApi({
            getMsgsByMsgId: vi.fn(async () => ({
                result: 0,
                msgList: [{ msgId: "m1", elements: [{ textElement: { text: "x" } }] }],
            })),
        });
        await expect(api.fetchPttText("m1", target)).rejects.toThrow(/不包含语音/);
    });

    it("消息不存在抛 NOT_FOUND", async () => {
        const { api } = makeApi({
            getMsgsByMsgId: vi.fn(async () => ({ result: 0, msgList: [] })),
        });
        await expect(api.fetchPttText("m1", target)).rejects.toThrow(/不包含语音/);
    });
});

describe("sendForwardMessage", () => {
    it("空 srcMsgIds 抛 INVALID_PARAM", async () => {
        const { api } = makeApi();
        await expect(api.sendForwardMessage(target, target, [])).rejects.toThrow(/至少一条源消息/);
    });

    it("成功返回 msgId", async () => {
        const { api, service } = makeApi({
            buildMultiForwardMsg: vi.fn(async () => ({
                result: 0,
                rspInfo: { elements: [{ textElement: { text: "x" } }] },
            })),
        });
        await expect(api.sendForwardMessage(target, target, ["s1"])).resolves.toEqual({
            msgId: "msgid-1",
        });
        expect(service.sendMsg).toHaveBeenCalled();
    });

    it("组装无元素抛 UNKNOWN", async () => {
        const { api } = makeApi();
        await expect(api.sendForwardMessage(target, target, ["s1"])).rejects.toThrow(
            /合并转发组装失败/,
        );
    });
});

describe("fetchForwardMessage", () => {
    it("消息含合并转发且取到内容", async () => {
        const forwardMsg = {
            msgId: "m1",
            elements: [{ multiForwardMsgElement: { resId: "r1" } }],
        };
        const { api, service } = makeApi({
            getMultiMsg: vi.fn(async () => ({
                result: 0,
                msgList: [{ msgId: "inner" }],
            })),
        });
        (service.getMsgsByMsgId as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            result: 0,
            msgList: [forwardMsg],
        });
        await expect(api.fetchForwardMessage(target, "m1")).resolves.toEqual([{ msgId: "inner" }]);
    });

    it("消息无合并转发抛 NOT_FOUND", async () => {
        const { api } = makeApi();
        api as unknown as { fetchMsgsByMsgId: ReturnType<typeof vi.fn> };
        const service = (
            api as unknown as { service: { getMsgsByMsgId: ReturnType<typeof vi.fn> } }
        ).service;
        service.getMsgsByMsgId.mockResolvedValueOnce({
            result: 0,
            msgList: [{ msgId: "m1", elements: [{ textElement: { text: "x" } }] }],
        });
        await expect(api.fetchForwardMessage(target, "m1")).rejects.toThrow(/不包含合并转发/);
    });
});
