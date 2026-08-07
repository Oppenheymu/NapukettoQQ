# @napuketto/adapter

NapukettoQQ 协议适配器容器：core 框架 + OneBot 11（Satori 规划中）。

- **core**：协议适配器生命周期框架（`BaseProtocolAdapter` / `BaseAction` / 动作注册表 / 配置校验）
- **onebot11**：60+ 动作（消息 / 群 / 好友 / 系统），HTTP / WebSocket / 反向 WebSocket 多实例传输，鉴权 + 心跳

## 子路径

- `@napuketto/adapter/core` — 框架层
- `@napuketto/adapter/onebot11` — OneBot 11 实现

## 约束

- 只认识 kernel 的语义化 API / 事件通道 / 缓存，不认识原生
