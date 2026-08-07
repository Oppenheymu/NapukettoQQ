# HANDOVER-V9：🎉 session READY 突破——「先 init 后 start」顺序激活业务 service（2026-08-07 深夜）

> **本文件是本次会话（2026-08-07 深夜）的交接文档**，记录**推翻 HANDOVER-V8「硬墙」结论的决定性突破**。
> 新对话先读 `docs/STATUS.md`（现状）→ `docs/architecture.md`（架构书）→ `docs/HANDOVER-V7.md`（stub 等价物）
> → 本文件（最新突破）。本文件位于 `docs/`（本地，gitignore），不随公共仓库分发。

---

## 🎯 本次会话核心结论（一句话）

**自建宿主（路线 A）session 业务 service 可激活——不是硬墙！**
关键 = **`session.init(config)` 之后调 `startupSession.start()`**（NapCat initializeSession 顺序）。
此前 p0-session-ready 失败是因为：① 先 `ssw.start()` 再 init（顺序颠倒）② 或 init 后用 startNT 而非
startupSession.start()。**改正顺序后 `onOpentelemetryInit(is_init=true)` 触发，getMsgService READY
（298 方法），getGroupService/getBuddyService/getTicketService/getProfileService 全部有效！**

---

## ✅ 决定性突破（2026-08-07 深夜，全部实测）

### 验证链路（p0-napcat-min.mjs，变体 A/C 全过）

```
标准 node + stub QQNT.dll + power-window（窗口类）+ 9.9.33 wrapper.node
  ├─ dlopen 98 exports
  ├─ O3MiscService.addO3MiscListener（激活事件分发）
  ├─ SSW.create() + getNTWrapperSession("nt_1")
  ├─ engine init + initConfig + getLoginList + connect + quickLoginWithUin(3567141148)  → ✅ 登录成功
  ├─ ⭐ session.init(sessionConfig, depends, dispatcher, listener)  ← 先 init
  ├─ ⭐ startupSession.start()                                       ← 后 start（NapCat 顺序！）
  ├─ ⚡ onOpentelemetryInit: {"is_init":true,"is_report":true}        ← 完成信号！
  └─ ✅✅✅ getMsgService READY（298 方法）+ 4 个业务 service 全部有效
```

### 隔离实验（找出决定性因素）

| 变体 | 内容 | 结果 |
|---|---|---|
| **A** | init 后 start + deviceConfig + defaultFileDownloadPath（无 O3 上报、无 UUID guid） | ✅✅✅ READY |
| **C** | init 后 start（**无 deviceConfig**） | ✅✅✅ READY |
| （历史失败）p0-session-ready | 先 `ssw.start()` 等 READY → 失败回退 `initAndStartSession`（init + startNT） | ❌ null |

**结论**：
1. **决定性因素 = 调用顺序**：`session.init(config)` **之后** `startupSession.start()`。
   - NapCat `initializeSession`：先 `session.init(...)`，再 `if (startupSession) startupSession.start();`
     `else session.startNT(0)`。
   - p0-session-ready 先 start 后 init → startupSession 状态机未就绪 → service 不挂载。
   - initAndStartSession 用 `startNT`（非 startupSession.start）→ 同样失败。
2. **非必要因素**（已隔离排除）：O3 setAmgomDataPiece / reportAmgomWeather（可选）、
   UUID guid（可选）、deviceConfig 字段（可选）、defaultFileDownloadPath（可选，但建议保留）。
3. **窗口类**：仍然注册（与之前相同），作用存疑但无副作用。

### 🔑 关键机制（NapCat base.ts 参考，自研验证）

```js
// NapCat initializeSession（机制参考，零复制）：
session.init(sessionConfig, dependsAdapter, dispatcherAdapter, sessionListener);  // ① 先 init
if (startupSession) {
    startupSession.start();   // ② 后 start（关键！）
} else {
    session.startNT(0);       // 兜底
}
// 等 sessionListener.onOpentelemetryInit(info.is_init === true)
```

---

## 📌 产品路线更新（重大）

| 路线 | 状态 | 说明 |
|---|---|---|
| **A. 自建宿主** | ✅✅✅ **可救！（推翻 V8 硬墙结论）** | session READY 通过 → kernel/adapter 零改动复用 → 冒烟收发可行 |
| **B. 注入 worker** | ✅ 已验证兜底 | 继续保留 |

**下一步（按优先级）**：
1. **kernel 落地**：修正 `lifecycle.initAndStartSession` 顺序——先 session.init 再
   startupSession.start（当前是 startNT 兜底）。boot-bootstrap.js 的「start 后 READY」路径
   也要修正为「init 后 start」。
2. **冒烟收发**：自建宿主下 MsgBridge + MsgApi 真发/收一条（boot-smoke.js 逻辑移植）。
3. **内存实测**：标准 node + stub + 登录态的实际占用（百兆级目标）。
4. **loader 自建宿主引导**：新增 NAPUTO_SELF_HOST 分支（标准 node + stub + boot.cjs 复用）。

---

## 📁 实验文件清单（均在 `packages/loader/native-private/`，闭源 gitignore）

| 文件 | 作用 | 状态 |
|---|---|---|
| `p0-napcat-flow.mjs` | 全量对齐 NapCat 流程（O3 上报 + UUID guid + deviceConfig） | ✅✅ 首次 READY |
| `p0-napcat-min.mjs` | 最小化隔离（变体 A=无O3无UUID；C=无deviceConfig） | ✅✅ 决定性 |
| `p0-o3-probe.mjs` | O3MiscService 方法面（setAmgomDataPiece/reportAmgomWeather 存在可调） | ✅ |
| `stub-qqnt.cpp/.def` / `QQNT-stub-full.dll` | 正式版 stub（HANDOVER-V8 产物，回归通过） | ✅ |
| `power-window.cpp/.node` | 窗口类插件（非必要但保留） | ✅ |
| `p0-session-ready.mjs` | 旧失败路径（先 start 后 init）——**勿再用** | ❌ 记录 |

**运行方式**（PowerShell）：
```powershell
cd packages\loader\native-private
$env:PATH = "C:\Dev\QQBot-Dev\NapukettoQQ\packages\loader\native-private\stub-test-env;C:\Dev\QQBot-Dev\QQNT\versions\9.9.33-51802\resources\app;" + $env:PATH
$env:NAPUTO_WRAPPER_PATH="C:\Dev\QQBot-Dev\QQNT\versions\9.9.33-51802\resources\app\wrapper.node"
$env:NAPUTO_QQ_VERSION="9.9.33-51802"
$env:NAPUTO_QUICK_UIN="3567141148"
node p0-napcat-min.mjs   # 变体 A（默认）
$env:NAPUTO_VARIANT="C"; node p0-napcat-min.mjs  # 变体 C（无 deviceConfig）
```
（wrapper 后台线程干扰 stdout——日志写文件 p0-napcat-min-{A,C}.log）

---

## 🧭 会话状态快照

- **git**：工作区干净（实验文件在 `native-private/` gitignore 内）
- **环境事实**：QQ 9.9.33-51802；快速登录账号 **3567141148（吉帕斯喵）**；
  3054108135 账号风控勿用；QQ 数据根 `Documents\Tencent Files\`（nt_qq/global 才是 commonPath）。
