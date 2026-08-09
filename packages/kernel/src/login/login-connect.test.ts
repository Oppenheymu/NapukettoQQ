/**
 * login-connect.ts 基线测试（fallow 重构目标，untested risk）
 *
 * 覆盖快速登录纯逻辑：
 *  - pickLoginTarget：显式 uin 命中 / 未命中报错 / 缺省优先 quick / 空列表报错
 *  - isNetworkError：网络异常码 / 连接异常提示 / 其他错误
 *  - waitForNetworkConnection：loginService 形状校验
 */
import { describe, expect, it } from "vitest";
import type { WrapperContext } from "../wrapper/wrapper-loader.js";
import {
    isNetworkError,
    type LoginAccountInfo,
    pickLoginTarget,
    waitForNetworkConnection,
} from "./login-connect.js";

describe("pickLoginTarget", () => {
    const items: LoginAccountInfo[] = [
        { uin: "10001", uid: "u1", nickName: "A", isQuickLogin: false },
        { uin: "10002", uid: "u2", nickName: "B", isQuickLogin: true },
        { uin: "10003", uid: "u3", nickName: "C", isQuickLogin: true },
    ];

    it("显式 uin 命中返回对应账号", () => {
        expect(pickLoginTarget(items, "10002")).toEqual(items[1]);
    });

    it("显式 uin 未命中抛 NOT_FOUND", () => {
        expect(() => pickLoginTarget(items, "99999")).toThrow(/不在登录列表/);
    });

    it("未指定 uin 优先第一个可快速登录账号", () => {
        expect(pickLoginTarget(items, undefined)).toEqual(items[1]);
    });

    it("无快速登录账号时取列表第一个", () => {
        const noQuick = [{ uin: "10001", isQuickLogin: false }];
        expect(pickLoginTarget(noQuick, undefined)).toEqual(noQuick[0]);
    });

    it("空列表抛 NOT_LOGIN", () => {
        expect(() => pickLoginTarget([], undefined)).toThrow(/无可用登录账号/);
    });
});

describe("isNetworkError", () => {
    it("含 1006511 网络异常码", () => {
        expect(isNetworkError("错误码: 1006511")).toBe(true);
    });

    it("含登录系统连接异常提示", () => {
        expect(isNetworkError("登录系统连接异常")).toBe(true);
    });

    it("其他错误返回 false", () => {
        expect(isNetworkError("密码错误")).toBe(false);
        expect(isNetworkError("")).toBe(false);
    });
});

describe("waitForNetworkConnection", () => {
    it("loginService 缺失返回 false", async () => {
        const ctx = { loginService: null } as unknown as WrapperContext;
        await expect(waitForNetworkConnection(ctx)).resolves.toBe(false);
    });

    it("loginService 无 getMsfStatus 返回 false", async () => {
        const ctx = { loginService: {} } as unknown as WrapperContext;
        await expect(waitForNetworkConnection(ctx)).resolves.toBe(false);
    });
});
