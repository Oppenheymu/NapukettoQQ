/**
 * native-noise.test.ts：isNativeNoiseLine 判定单测。
 *
 * 钉死三类边界：七分支噪音模式命中（大小写不敏感）、IPC JSON 协议行永不命中
 * （含载荷嵌入噪音样文本的协议行——构造性保证过滤与协议无交集，防丢消息事件）、
 * 空行 / 普通日志 / QR 标记行不命中。
 */
import { describe, expect, it } from "vitest";
import { isNativeNoiseLine } from "../native-noise.js";

describe("isNativeNoiseLine", () => {
    it("七类原生噪音模式命中（大小写不敏感）", () => {
        const noiseLines = [
            "<MMKV> close finish, remains = 0",
            "<MemoryFile_Win32> mmap file failed",
            "<MMKV_IO> lock file fd = 3",
            "loadSymbolFromShell: NodeContextifyContextMetrics",
            "getNodeGetJsListApi: GetProcAddress failed",
            "get symbol failed, name = NodeContextifyContextMetrics",
            "loaded [mmkv.default] with 12 key-values",
            "Loaded [MMKV.creater] WITH 12 key-values",
        ];
        for (const line of noiseLines) {
            expect(isNativeNoiseLine(line), `应为噪音行：${line}`).toBe(true);
        }
    });

    it("IPC JSON 协议行永不命中（含载荷嵌入噪音样文本，构造性无交集）", () => {
        const protocolLines = [
            '{"v":1,"type":"ping"}',
            '{"v":1,"type":"status","payload":{"phase":"logging"}}',
            '{"v":1,"type":"event","payload":{"message":"<MMKV> 用户消息里出现噪音样文本"}}',
            '{"v":1,"type":"log","payload":{"level":"info","message":"loaded [mmkv.x] with 1 key-values"}}',
        ];
        for (const line of protocolLines) {
            expect(isNativeNoiseLine(line), `应为协议行：${line.slice(0, 40)}`).toBe(false);
        }
    });

    it("空行 / 普通日志 / QR 标记行不命中", () => {
        expect(isNativeNoiseLine("")).toBe(false);
        expect(isNativeNoiseLine("[00:13:40.523] INFO (kernel/4242): 正常日志行")).toBe(false);
        expect(isNativeNoiseLine('NAPUTO_QR {"qrcodeUrl":"https://q.qq.com/xyz"}')).toBe(false);
    });
});
