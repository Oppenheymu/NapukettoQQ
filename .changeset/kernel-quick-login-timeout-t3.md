---
"@napuketto/kernel": patch
---

fix(kernel): 快速登录超时兜底（T3）——根治软重登永久挂起

服务端已有同账号会话时底层 quickLoginWithUin/getLoginList NAPI promise 永不
settle：quickLogin 裸 await 挂起导致 core.login 的 catch/qrFallback 形同虚设、
QrLoginSession quickUin 路径连 120s 兜底计时都不启动、loader control login 的
control.release 不执行（登录互斥永不释放、面板无反馈）。

- quickLogin：getLoginList 与每次 quickLoginWithUin 包 20s 超时竞速
  （CoreLoginOptions.quickLoginTimeoutMs / QuickLoginOptions.quickLoginTimeoutMs
  可配），超时按登录失败（「快速登录失败: 快速登录超时」）抛出，现有
  catch/qrFallback 语义自动生效；超时文案不含网络错误特征，不触发 1006511
  重试叠挂。底层 promise 无法取消，超时后悬挂丢弃。
- QrLoginSession：quickUin 路径在快速登录前先启动超时定时器（挂起 → 超时
  failed）；失败回退仅限 idle 态，悬挂 promise 迟到结果不复活会话。
- loader：control login 透传 quickLoginTimeoutMs=20000。
