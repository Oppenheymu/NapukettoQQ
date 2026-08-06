# @napuketto/network 设计

> 职责：**协议无关的传输原语**。不 import 任何协议包，事件类型泛型化。
> 对应 ADR：002
> 状态：全部模块已实现（types / broadcaster / http-server / http-client / ws-server / ws-client，2026-08-04，见 §8），通过 `pnpm check` + 16 项运行时冒烟测试。

---

## 1. 边界

- **做**：HTTP server/client、WS server/client、多适配器广播总线、token 鉴权钩子。
- **不做**：协议事件模型（OB11/OB12/Satori）、action 注册表、数据翻译、CQ 码。

## 2. 目录结构

```
packages/network/src/
├── broadcaster.ts            # 泛型 EventBroadcaster（多适配器注册/广播/启停）
├── http-server.ts            # hono 反向 HTTP（接收第三方调用）
├── http-client.ts            # hono 正向 HTTP（事件上报）
├── ws-server.ts              # ws 反向 WS（被动）
├── ws-client.ts              # ws 正向 WS（主动/反向连接）
└── types.ts                  # TransportAdapter / 分发钩子接口
```

依赖：`hono`、`@hono/node-server`、`ws`、`@types/ws`（dev）。**零内部包依赖**。

## 3. 核心接口（草案）

```ts
// 传输适配器：协议无关
interface TransportAdapter {
    send<T>(payload: T): void;                 // 协议无关推送
    open(): void | Promise<void>;
    close(): void | Promise<void>;
    onRequest?: (req: unknown, respond: (res: unknown) => void) => void;
}

// 广播总线：对应 NapCat 的 OB11NetworkManager，但泛型化
class EventBroadcaster {
    register(adapter: TransportAdapter): void;
    unregister(adapter: TransportAdapter): void;
    emit<T>(event: T): void;                   // 广播给所有适配器
    openAll(): Promise<void>;
    closeAll(): Promise<void>;
}
```

## 4. 与 NapCat 的关键差异

NapCat 的 `OB11NetworkAdapter` 把事件类型绑死 OB11（`onEvent<T extends OB11BaseEvent>`），且持有 `actions` 分发器。我们的版本把"路由分发"外置为 `onRequest` 注入点，由协议层（onebot）提供；事件类型完全泛型化。

## 5. 复用规则

- 新增协议（Satori）→ 新建平级包，依赖 `kernel + network`，**network 零改动**。
- 鉴权（token 校验）以可配置钩子提供，具体校验规则由协议层决定。

## 6. 实现顺序

1. ✅ `types.ts`（接口先行，2026-08-04）
2. ✅ `broadcaster.ts`（最基础）
3. ✅ `http-server.ts`（hono + @hono/node-server 反向 HTTP）
4. ✅ `ws-server.ts`（反向 WS）
5. ✅ `http-client.ts` / `ws-client.ts`（正向上报 / 主动连接）

## 7. 待验证事项

- ~~hono 在纯 Node 环境作为反向 HTTP server 的成熟度~~ → 已定：`@hono/node-server` 适配器，`serve({ fetch, hostname, port })`。
- ~~WS 心跳/断线重连策略参数~~ → 已定：`heartbeat?: { intervalMs }` 与 `reconnect?: { enabled, delayMs, maxAttempts? }` 均为可选，默认关闭，由协议层决定开启。

## 8. 实现记录（2026-08-04）

- **`onRequest` 响应回发**：WS server/client 内部把 `respond` 绑定到**当前客户端/连接**——协议层 `onRequest(req, respond)` 实现是协议无关的，天然支持 HTTP 与 WS 两种入口。
- **HttpServer.send 为 no-op**：HTTP 反向是被动接收，无主动推送；主动推送走正向上报（HttpClient / WsClient）。
- **HttpClient 用 async post + `.catch()` 链**：`send` 同步触发，内部 `post` 异步（AbortController 超时），错误经 `onError` 回调交给协议层（不静默吞掉，符合工程约束）。
- **鉴权钩子**：`authorize(ctx)` 由协议层注入，HTTP 返回 401、WS 关闭 4401。
- **WsClient.open() 不自动重试**：失败 reject 由协议层决定；断线后的自动重连由 `reconnect` 选项控制（attempt 计数 + maxAttempts）。
- **biome 严格规则适配**：`TransportAdapter` 接口方法用属性式签名（useConsistentMethodSignatures）；WS 关闭码/HTTP 状态码用命名常量（noMagicNumbers）；`this.x` 访问改解构（useDestructuring）；Qwik 序列化规则误报（useQwikValidLexicalScope）已关；`@types/ws` 必须装（ws 无自带类型）。
