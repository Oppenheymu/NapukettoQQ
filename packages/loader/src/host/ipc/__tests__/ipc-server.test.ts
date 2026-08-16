/**
 * ipc-server.test.ts：handleControl 控制指令分派单测（纯函数，mock 回调）。
 */
import { describe, expect, it, vi } from "vitest";
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
});
