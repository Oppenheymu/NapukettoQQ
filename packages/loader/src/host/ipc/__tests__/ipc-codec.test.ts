/**
 * ipc-codec.test.ts：IPC 编解码单测（与 koishi 插件侧 codec.test.ts 对齐）。
 */
import { describe, expect, it } from "vitest";
import { decodeIpcMessage, encodeIpcMessage } from "../ipc-codec.js";
import { IPC_VERSION, type IpcMessage } from "../ipc-types.js";

describe("ipc-codec", () => {
    it("encode/decode roundtrip", () => {
        const message: IpcMessage = {
            v: IPC_VERSION,
            type: "event",
            payload: { service: "Msg", name: "onRecvMsg", args: [{ msgId: 1 }] },
        };
        const line = encodeIpcMessage(message);
        expect(line.endsWith("\n")).toBe(true);
        expect(decodeIpcMessage(line)).toEqual(message);
    });

    it("decode 非法输入返回 null", () => {
        expect(decodeIpcMessage("")).toBeNull();
        expect(decodeIpcMessage("   ")).toBeNull();
        expect(decodeIpcMessage("not json")).toBeNull();
        expect(decodeIpcMessage('{"v":1,"type":"nope"}')).toBeNull();
        expect(decodeIpcMessage('{"v":999,"type":"ping"}')).toBeNull();
        expect(decodeIpcMessage("[1,2,3]")).toBeNull();
    });

    it("decode 容忍多余空白", () => {
        const message = { v: IPC_VERSION, type: "ping" } as const;
        expect(decodeIpcMessage(`  ${encodeIpcMessage(message).trim()}  `)).toEqual(message);
    });
});
