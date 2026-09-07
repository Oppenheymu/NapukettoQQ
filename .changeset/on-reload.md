---
"@napuketto/adapter": patch
---

feat(adapter): onReload 热更新实现——OB11/Satori 配置变更后 stop 旧传输（心跳/退订/关闭）→ 按新配置重建（P2-6 兑现）；OB11 IPC 桥模式（subscribeOnly）无传输不重建，仅刷新上报开关与消息格式
