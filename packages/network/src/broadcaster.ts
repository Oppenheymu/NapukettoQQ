/**
 * 泛型广播总线（ADR-002）
 *
 * 对应 NapCat 的 OB11NetworkManager，但完全泛型化：
 * 协议层注册自己的传输适配器，`emit` 把事件广播给所有适配器。
 */
import type { TransportAdapter } from "./types.js";

export class EventBroadcaster {
    private readonly adapters = new Set<TransportAdapter>();

    /** 注册适配器（重复注册忽略）。 */
    register(adapter: TransportAdapter): void {
        this.adapters.add(adapter);
    }

    /** 注销适配器。 */
    unregister(adapter: TransportAdapter): void {
        this.adapters.delete(adapter);
    }

    /** 广播事件给所有已注册适配器（同步派发，发送失败由适配器自行兜底）。 */
    emit<T>(event: T): void {
        for (const adapter of this.adapters) {
            adapter.send(event);
        }
    }

    /** 启动全部已注册适配器。 */
    async openAll(): Promise<void> {
        await Promise.all([...this.adapters].map((adapter) => adapter.open()));
    }

    /** 关闭全部已注册适配器。 */
    async closeAll(): Promise<void> {
        await Promise.all([...this.adapters].map((adapter) => adapter.close()));
    }

    /** 当前已注册适配器数量。 */
    get size(): number {
        return this.adapters.size;
    }
}
