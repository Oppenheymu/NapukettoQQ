/**
 * ipc-bootstrap.test.ts：IPC 装配单测（attachIpcServices）。
 *
 * 回归重点（2026-08-20 生产事故）：kernel 的 Api 是**类**，注入其方法必须保 this。
 * ipc-actions.test.ts 注入的是 `vi.fn` 裸函数（本身不依赖 this），因此测不出
 * 「摘方法丢 this」这类装配缺陷——本文件用「方法读 this.service」的假 GroupApi
 * 覆盖该缺陷：未 bind 时 uinToUid 会抛
 * `Cannot read properties of undefined (reading 'service')`。
 */
import { describe, expect, it } from "vitest";
import type { KernelServices } from "../../core/kernel-services.js";
import { callIpcAction, type IpcActionHandler, type IpcPeer } from "../ipc-actions.js";
import { attachIpcServices } from "../ipc-bootstrap.js";

/** 假 GroupApi：与 kernel GroupApi 同构——uinToUid 经 `this.service` 调原生。 */
class FakeGroupApi {
    private readonly service = {
        getUidByUins: async (uins: string[]) => ({
            errCode: 0,
            uids: new Map(uins.map((uin) => [uin, `u_${uin}`])),
        }),
    };

    async uinToUid(uins: string[]): Promise<Map<string, string>> {
        const raw = await this.service.getUidByUins(uins);
        return raw.uids;
    }

    async getGroupList(): Promise<unknown[]> {
        return [];
    }
}

/** 最小 KernelServices（只填动作表用到的成员；其余 unknown 字段经 cast 省略）。 */
function mockServices(): { services: KernelServices; sent: IpcPeer[] } {
    const sent: IpcPeer[] = [];
    const services = {
        msgApi: {
            sendMessage: async (peer: IpcPeer) => {
                sent.push(peer);
                return { msgId: "42" };
            },
        },
        groupApi: new FakeGroupApi(),
        groupCache: { listGroupsRefreshed: async () => [] },
        friendApi: { getFriendList: async () => [] },
        self: { uin: "10001", nickname: "测试号" },
        // forwardChannel 只在 onAny 是函数时订阅——空对象即跳过事件转发
        channel: {},
        groupChannel: {},
    } as unknown as KernelServices;
    return { services, sent };
}

describe("attachIpcServices", () => {
    it("私聊 peerUin → uid：注入的 uinToUid 保留 this（不再 undefined.service）", async () => {
        const { services, sent } = mockServices();
        const actions = new Map<string, IpcActionHandler>();
        attachIpcServices(actions, services);

        const result = await callIpcAction(actions, "msg.sendMessage", {
            chatType: 1,
            peerUin: "12345",
            elements: [{ type: "text", text: "你好" }],
        });

        expect(result).toEqual({ ok: true, value: { msgId: "42" } });
        expect(sent[0]).toEqual({ chatType: 1, peerUid: "u_12345" });
    });

    it("群聊 peerUin 直通群号（不经 uinToUid）", async () => {
        const { services, sent } = mockServices();
        const actions = new Map<string, IpcActionHandler>();
        attachIpcServices(actions, services);

        const result = await callIpcAction(actions, "msg.sendMessage", {
            chatType: 2,
            peerUin: "978515338",
            elements: [],
        });

        expect(result).toEqual({ ok: true, value: { msgId: "42" } });
        expect(sent[0]).toEqual({ chatType: 2, peerUid: "978515338" });
    });

    it("动作表并入后 login.getSelf 可用（装配确实生效）", async () => {
        const { services } = mockServices();
        const actions = new Map<string, IpcActionHandler>();
        const stop = attachIpcServices(actions, services);

        const result = await callIpcAction(actions, "login.getSelf", undefined);

        expect(result).toEqual({ ok: true, value: { uin: "10001", nickname: "测试号" } });
        expect(() => stop()).not.toThrow();
    });
});
