/**
 * login.ts QrLoginSession 测试（2026-08-13：快速登录失败回退二维码回归）
 *
 * 覆盖核心契约：`quickLoginWithUin` 失败时是 **resolve 带 loginErrorInfo.errMsg**
 * （非 reject）——此前只挂 .catch 导致无凭据环境（WSL 扫码）永不 refresh 出码。
 */
import { describe, expect, it, vi } from "vitest";
import { QR_LOGIN_TIMEOUT_MESSAGE, QR_LOGIN_TIMEOUT_MS, QrLoginSession } from "./login.js";

/** 构造假 loginService（可注入回调序列）。 */
function createFakeLoginService(overrides: Partial<Record<string, unknown>> = {}) {
    const listeners: Record<string, unknown>[] = [];
    return {
        addKernelLoginListener: vi.fn((listener: unknown) => {
            listeners.push(listener as Record<string, unknown>);
            return listeners.length;
        }),
        removeKernelLoginListener: vi.fn(),
        connect: vi.fn(),
        getLoginList: vi.fn(async () => ({ result: 0, LocalLoginInfoList: [] })),
        quickLoginWithUin: vi.fn(async () => ({
            result: "0",
            loginErrorInfo: { errMsg: "" },
        })),
        getQRCodePicture: vi.fn(() => true),
        ...overrides,
    };
}

describe("QrLoginSession.start 快速登录回退", () => {
    /** 等微任务（quickLoginWithUin 是 async，resolve/reject 在微任务队列）。 */
    async function flush(): Promise<void> {
        await Promise.resolve();
        await Promise.resolve();
    }

    it("quickLoginWithUin resolve 带 errMsg（非 reject）→ 回退 getQRCodePicture", async () => {
        const svc = createFakeLoginService({
            // ⚠️ wrapper 契约：失败 = resolve 带 errMsg，不是 reject
            quickLoginWithUin: vi.fn(async () => ({
                result: "0",
                loginErrorInfo: { errMsg: "无登录凭据" },
            })),
        });
        const session = new QrLoginSession(svc);
        const qrCalls: string[] = [];
        session.onQrCode(() => qrCalls.push("qr"));
        let state: string | null = null;
        session.onStateChange((s) => (state = s));

        session.start({ quickUin: "123456" });
        await flush();

        // 快速登录失败 → 立即 refresh → getQRCodePicture + waiting_scan
        expect(svc.getQRCodePicture).toHaveBeenCalledTimes(1);
        expect(state).toBe("waiting_scan");
    });

    it("quickLoginWithUin reject（异常路径）→ 同样回退二维码", async () => {
        const svc = createFakeLoginService({
            quickLoginWithUin: vi.fn(async () => {
                throw new Error("quick login crash");
            }),
        });
        const session = new QrLoginSession(svc);
        session.start({ quickUin: "123456" });
        await flush();
        expect(svc.getQRCodePicture).toHaveBeenCalledTimes(1);
    });

    it("quickLoginWithUin 成功（errMsg 空）→ 不 refresh（等待登录回调）", async () => {
        const svc = createFakeLoginService();
        const session = new QrLoginSession(svc);
        let state: string | null = null;
        session.onStateChange((s) => (state = s));

        session.start({ quickUin: "123456" });
        await flush();

        expect(svc.getQRCodePicture).not.toHaveBeenCalled();
        expect(state).toBeNull();
    });

    it("未指定 quickUin → 直接出码（QR 登录主路径）", () => {
        const svc = createFakeLoginService();
        const session = new QrLoginSession(svc);
        session.start();
        expect(svc.getQRCodePicture).toHaveBeenCalledTimes(1);
        expect(svc.quickLoginWithUin).not.toHaveBeenCalled();
    });
});

describe("QrLoginSession 超时与手动刷新", () => {
    it("出码后超时未登录 → failed + 超时提示", () => {
        vi.useFakeTimers();
        try {
            const svc = createFakeLoginService();
            const session = new QrLoginSession(svc);
            let state: string | null = null;
            session.onStateChange((s) => (state = s));

            session.start(); // 直接出码（无 quickUin）
            expect(state).toBe("waiting_scan");

            vi.advanceTimersByTime(QR_LOGIN_TIMEOUT_MS);
            expect(state).toBe("failed");
            expect(session.failureReason).toBe(QR_LOGIN_TIMEOUT_MESSAGE);
        } finally {
            vi.useRealTimers();
        }
    });

    it("refresh 重置超时计时器 + 清空 failureReason", () => {
        vi.useFakeTimers();
        try {
            const svc = createFakeLoginService();
            const session = new QrLoginSession(svc);
            let state: string | null = null;
            session.onStateChange((s) => (state = s));

            session.start();
            vi.advanceTimersByTime(60_000); // 60s，未超时
            expect(state).toBe("waiting_scan");

            session.refresh(); // 手动刷新：重置计时
            vi.advanceTimersByTime(60_000); // 距刷新 60s，仍 waiting_scan
            expect(state).toBe("waiting_scan");

            vi.advanceTimersByTime(60_000); // 距刷新 120s → 超时
            expect(state).toBe("failed");
            expect(session.failureReason).toBe(QR_LOGIN_TIMEOUT_MESSAGE);
        } finally {
            vi.useRealTimers();
        }
    });
});
