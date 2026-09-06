/**
 * ipc-server.test.ts：handleControl 控制指令分派单测（纯函数，mock 回调）。
 */
import { describe, expect, it, vi } from "vitest";
import { enableIpc, sendStatus } from "../ipc-sender.js";
import { handleControl } from "../ipc-server.js";

describe("handleControl", () => {
    it("stop → onExit", () => {
        const onExit = vi.fn();
        handleControl({ command: "stop" }, onExit);
        expect(onExit).toHaveBeenCalledOnce();
    });

    it("restart → onExit", () => {
        const onExit = vi.fn();
        handleControl({ command: "restart" }, onExit);
        expect(onExit).toHaveBeenCalledOnce();
    });

    it("login qr=true → onLogin { qr: true }（强制扫码）", () => {
        const onLogin = vi.fn();
        handleControl({ command: "login", qr: true }, vi.fn(), onLogin);
        expect(onLogin).toHaveBeenCalledWith({ qr: true });
    });

    it("login uin → onLogin { uin }（指定账号）", () => {
        const onLogin = vi.fn();
        handleControl({ command: "login", uin: "3567141148" }, vi.fn(), onLogin);
        expect(onLogin).toHaveBeenCalledWith({ uin: "3567141148" });
    });

    it("login 无参数 → onLogin {}", () => {
        const onLogin = vi.fn();
        handleControl({ command: "login" }, vi.fn(), onLogin);
        expect(onLogin).toHaveBeenCalledWith({});
    });

    it("login 未提供 onLogin → 不抛（忽略）", () => {
        expect(() => handleControl({ command: "login" }, vi.fn())).not.toThrow();
    });

    it("status → 不触发 onExit，重播最近一条 status（stdout 拦截验证）", () => {
        const onExit = vi.fn();
        const lines: string[] = [];
        const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
            lines.push(String(chunk));
            return true;
        });
        try {
            enableIpc();
            sendStatus("sessioning", "装配中");
            const sentBefore = lines.length;
            handleControl({ command: "status" }, onExit);
            expect(onExit).not.toHaveBeenCalled();
            expect(lines).toHaveLength(sentBefore + 1);
            expect(lines.at(-1)).toBe(lines[sentBefore]); // 重播内容与原条一致
        } finally {
            write.mockRestore();
        }
    });
});
