/**
 * login-control.test.ts：control login 抢占单测（2026-09-08 T2）。
 *
 * createLoginControlHandler：qr/uin 参数展开、成功结果经 preemptRef 接管
 * 初始登录竞速、失败/空结果发 failed。非 IPC 测试环境 sendQr/sendLogin
 * 内部 no-op（ipc-sender enabled=false），只断言 core.login 调用与 preempt。
 */
import { describe, expect, it, vi } from "vitest";
import type { CoreLike, LoginResultLike } from "../../types.js";
import { createLoginControlHandler } from "../bootstrap-core.js";

/** 桩 core：login 可控 resolve。 */
function makeCore(result: LoginResultLike | null): {
    core: CoreLike;
    loginCalls: Record<string, unknown>[];
} {
    const loginCalls: Record<string, unknown>[] = [];
    const core = {
        login: (opts: Record<string, unknown>) => {
            loginCalls.push(opts);
            return Promise.resolve(result);
        },
    } as unknown as CoreLike;
    return { core, loginCalls };
}

const RESULT: LoginResultLike = { uin: "10001", uid: "u1", nick: "测试" };

describe("createLoginControlHandler", () => {
    it("qr=true → qrOnly:true；uin → quickUin；qrFallback 常开", async () => {
        const { core, loginCalls } = makeCore(RESULT);
        const handler = createLoginControlHandler(core, "537376818");
        handler({ uin: "10001", qr: true });
        await vi.waitFor(() => {
            expect(loginCalls).toHaveLength(1);
        });
        const opts = loginCalls[0];
        expect(opts).toBeDefined();
        expect(opts?.["qrOnly"]).toBe(true);
        expect(opts?.["quickUin"]).toBe("10001");
        expect(opts?.["qrFallback"]).toBe(true);
        expect(opts?.["appid"]).toBe("537376818");
    });

    it("成功结果经 preemptRef.resolve 接管（登录期抢占）", async () => {
        const { core } = makeCore(RESULT);
        const preempt = { resolve: vi.fn() };
        const handler = createLoginControlHandler(core, 1, preempt);
        handler({});
        await vi.waitFor(() => {
            expect(preempt.resolve).toHaveBeenCalledWith(RESULT);
        });
    });

    it("preemptRef.resolve 为 null（竞速已结束）时不抛", async () => {
        const { core } = makeCore(RESULT);
        const handler = createLoginControlHandler(core, 1, { resolve: null });
        expect(() => handler({})).not.toThrow();
        await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it("core.login 返回 null 不触发抢占（sendLogin failed 由 ipc-sender no-op）", async () => {
        const { core } = makeCore(null);
        const preempt = { resolve: vi.fn() };
        const handler = createLoginControlHandler(core, 1, preempt);
        handler({});
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(preempt.resolve).not.toHaveBeenCalled();
    });

    it("core.login 抛错不触发抢占也不冒泡", async () => {
        const core = {
            login: () => Promise.reject(new Error("boom")),
        } as unknown as CoreLike;
        const preempt = { resolve: vi.fn() };
        const handler = createLoginControlHandler(core, 1, preempt);
        expect(() => handler({})).not.toThrow();
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(preempt.resolve).not.toHaveBeenCalled();
    });
});
