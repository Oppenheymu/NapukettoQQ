---
"@napuketto/kernel": patch
---

refactor(kernel): fallow 健康度重构——43 个 CRAP 超标函数降至 9（行为等价，2026-08-09）

- **降复杂度**：`wrapper-loader`（startNapuketto/createSession/startSession 回退链拆分）、
  `session-resolver`（findMainSessionId 统一 firstStringId）、`probe` 探测子系统
  （probeStartup/probeSession/enumerateSessionIds 拆小函数）、`login-connect`
  （attemptQuickLogin 提取重试单次）、`lifecycle`（watchInitSignal/startSessionBestEffort）、
  `core`（initLoginConfig/resolveCommonPath/waitQrLoggedIn）、`webapi`（honorTargets
  映射表替代 if 链）、`stranger-info`（pickField 字段级回退）、`group/msg/friend/richmedia`
  （extractGroupDetail/findPttElement/findForwardElement/toDoubtFriendRequestInfo 等纯函数提取）
- **补测试**（12 个新测试文件，201 → 454 用例全绿）：wrapper-loader / session-resolver /
  probe-utils / event-channel / login-connect / group-cache / wrapper-version /
  wrapper-config / group / friend / msg / richmedia 的 mock 基线测试
- 全部为行为等价重构（无 API 变化），`pnpm check` / 454 测试 / 全量构建全绿
