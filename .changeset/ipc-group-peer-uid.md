---
"@napuketto/loader": patch
---

fix(loader): IPC 动作表群聊 peer 解析——peerUin 直通为 peerUid，不再经 uinToUid 转换（getUidByUins 是用户转换 API，传群号属非法调用，QQ 原生内部抛 `Cannot read properties of undefined (reading 'service')`）；错误响应同时落 boot 日志（含完整堆栈）便于诊断
