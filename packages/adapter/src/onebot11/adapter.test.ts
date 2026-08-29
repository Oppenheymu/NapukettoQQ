/**
 * adapter.test.ts：OB11 适配器 IPC 桥面单测（subscribeOnly/unsubscribeOnly/registry）。
 *
 * subscribeOnly（2026-08-27，IPC 桥模式）与 start() 的差别仅在传输层：
 * 只订阅消息通道（维护 messageUnique + 灰色通知），不装配 HTTP/WS。
 * kernel apis 以宽松桩对象注入（动作注册表构造期只持有引用，不调用）。
 */
import type { MsgEventChannel } from "@napuketto/kernel";
import { EventBroadcaster } from "@napuketto/network";
import { describe, expect, it, vi } from "vitest";
import { ProtocolConfig } from "../core/index.js";
import { NapukettoOneBot11Adapter, type OneBot11AdapterOptions } from "./adapter.js";
import { ob11ConfigSchema } from "./helper/index.js";

/** 桩 kernel apis（构造期只持引用）。 */
function stubOptions(): Omit<OneBot11AdapterOptions, "config" | "broadcaster" | "msgChannel"> {
    return {
        msgApi: {},
        groupApi: {},
        groupNotifyApi: {},
        friendApi: {},
        ticketApi: {},
        richMediaApi: {},
        profileApi: {},
        profileLikeApi: {},
        webApi: {},
        self: { uin: "10001", nickname: "测试号" },
        system: { appVersion: "test" },
    } as unknown as Omit<OneBot11AdapterOptions, "config" | "broadcaster" | "msgChannel">;
}

/** 构造适配器（seed 配置——load() 返回内存初值，不读文件）。 */
function makeAdapter(channel: MsgEventChannel): NapukettoOneBot11Adapter {
    return new NapukettoOneBot11Adapter({
        ...stubOptions(),
        config: new ProtocolConfig({
            path: "ob11-test.toml",
            schema: ob11ConfigSchema,
            defaults: ob11ConfigSchema.parse({}),
            seed: ob11ConfigSchema.parse({}),
        }),
        broadcaster: new EventBroadcaster(),
        msgChannel: channel,
    });
}

/** 假消息通道（记录 on 调用，返回可控退订函数）。 */
function fakeChannel(): { channel: MsgEventChannel; off: ReturnType<typeof vi.fn> } {
    const off = vi.fn();
    const channel = { on: vi.fn(() => off) } as unknown as MsgEventChannel;
    return { channel, off };
}

describe("NapukettoOneBot11Adapter（IPC 桥面）", () => {
    it("subscribeOnly 订阅 Msg/onRecvMsg（幂等），unsubscribeOnly 退订", async () => {
        const { channel, off } = fakeChannel();
        const adapter = makeAdapter(channel);
        await adapter.subscribeOnly();
        expect(channel.on).toHaveBeenCalledTimes(1);
        expect(channel.on).toHaveBeenCalledWith("Msg/onRecvMsg", expect.any(Function));
        // 幂等：重复 subscribeOnly 不重复订阅
        await adapter.subscribeOnly();
        expect(channel.on).toHaveBeenCalledTimes(1);
        adapter.unsubscribeOnly();
        expect(off).toHaveBeenCalledTimes(1);
        // 退订后可重新订阅
        await adapter.subscribeOnly();
        expect(channel.on).toHaveBeenCalledTimes(2);
    });

    it("registry 公开且动作名平铺可枚举（IPC 桥整表挂载依赖）", () => {
        const { channel } = fakeChannel();
        const adapter = makeAdapter(channel);
        const names = adapter.registry.names;
        expect(names.length).toBeGreaterThan(50);
        for (const name of ["send_like", "get_login_info", "set_group_ban", "send_private_msg"]) {
            expect(names).toContain(name);
            expect(adapter.registry.get(name)).toBeDefined();
        }
    });
});
