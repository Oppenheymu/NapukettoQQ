# @napuketto/network

协议无关的传输原语层：HTTP / WebSocket / 泛型广播。

- **HttpServer / HttpClient** — 基于 Hono
- **WsServer / WsClient** — 基于 ws
- **EventBroadcaster** — 泛型事件广播

## 约束

- 不 import 任何协议包（adapter 等）；事件类型全泛型化
