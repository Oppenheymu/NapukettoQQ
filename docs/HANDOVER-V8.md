# HANDOVER-V8：session READY 硬墙验证 + 正式版 stub 完成（2026-08-07 深夜交接）

> **本文件是本次会话（2026-08-07 深夜）的交接文档**，记录 HANDOVER-V7 下一步 ①② 的执行结果：
> ① 正式版 stub 整理完成 ✅；② **session READY 验证——发现硬墙**（决定性结论）。
> 新对话先读 `docs/STATUS.md`（现状）→ `docs/architecture.md`（架构书）→ `docs/HANDOVER-V7.md`
> （stub 等价物研究）→ 本文件。本文件位于 `docs/`（本地，gitignore），不随公共仓库分发。

---

## 🎯 本次会话核心结论（一句话）

**自建宿主（路线 A）能登录，但 session 业务 service 无法激活——cpp_impl 激活是硬墙**：
标准 node + stub QQNT.dll 下登录链路全通（快速登录成功），但登录后
`getMsgService()/getGroupService()/getBuddyService()/getTicketService()` **全部 null**
（基础 service `getNodeMiscService`/`getMSFService` 却有效）。尝试了窗口类、
进程名伪装、票据 updateTicket、C++ RVA 激活链（复用 vehicle.cpp）——**全部无效**。
C++ 激活链在纯 Node 下 `FUN_180025d63`（创建 NTWrapperSession）**挂起**。
→ **session READY 依赖 QQ 主进程/渲染进程协作，自建宿主缺这个协作 = 硬墙。**

---

## ✅ ① 正式版 stub 完成（HANDOVER-V7 下一步①，全部实测）

### stub 等价物正式化（闭源 native-private）

| 项 | 状态 |
|---|---|
| `stub-qqnt.cpp` 正式版 | ✅ IsEnvironmentStopping（返回 false）+ **PerfTrace**（空实现，消除 GetProcAddress failed 日志） |
| `compare-symbols.mjs` 更新 | ✅ 加 PerfTrace 动态符号生成（def 100 条 = 99 静态 + PerfTrace） |
| `QQNT-stub-full.dll` | ✅ 编译成功 69KB（98 转发 + PerfTrace + IsEnvironmentStopping 别名） |
| 部署到 `stub-test-env/QQNT.dll` | ✅ |
| **回归登录（p0-login3）** | ✅✅✅ 完整通过：dlopen 98 exports → getLoginList 7 账号 → onLoginConnected → quickLoginWithUin(3567141148) result=0 |

**关键验证**：`llvm-objdump -p QQNT.dll` 确认官方 QQNT.dll 导出 `PerfTrace`（序号 2867）；
NapCat stub 也有（`NapCat_PerfTrace` + `PerfTrace` 同址空实现 `retq $0x0`）——补足正确。
`stub-qqnt.def` 现在由 compare-symbols.mjs 自动生成（含 PerfTrace），手工改动可被重跑覆盖。

---

## 🔬 ② session READY 验证（HANDOVER-V7 下一步②，决定性结论）

### 验证脚本与链路（p0-session-ready.mjs，全部实测）

```
标准 node + stub QQNT.dll（PATH 前置）+ power-window.node（窗口类）+ 9.9.33 wrapper.node
  ├─ process.dlopen → ✅ 98 exports
  ├─ O3MiscService.get() + addO3MiscListener → ✅ 激活事件分发
  ├─ SSW.create() + getNTWrapperSession("nt_1") → ✅ session 对象（89 方法）
  ├─ engine init（desktopGlobalPath = 数据根/nt_qq/global）→ ✅
  ├─ initConfig（commonPath 同）→ ✅
  ├─ getLoginList() → ✅ 7 账号
  ├─ connect() → ✅ onLoginConnected 触发
  ├─ quickLoginWithUin(3567141148) → ✅ result=0（登录成功）
  └─ ⭐ session READY 检查：getMsgService() → ❌ null（登录后 30s 轮询仍 null）
```

### 🚫 已穷尽的尝试（全部无效，勿重复探索）

| # | 尝试 | 结果 |
|---|---|---|
| 1 | `startupSession.start()`（登录后） | ❌ 调用成功但 service 仍 null（P2-0 worker 有效，自建宿主无效——缺渲染进程协作） |
| 2 | `initAndStartSession`（session.init + startNT，boot-bootstrap 回退路径） | ❌ 20s 超时（完成信号 onOpentelemetryInit 不来） |
| 3 | **Base_PowerMessageWindow 窗口类**（power-window.node，强制注册） | ❌ 窗口创建成功（hwnd 有效）但 service 仍 null——**非充分条件** |
| 4 | 进程名伪装（node 复制为 QQ.exe） | ❌ DLL init 失败（wrapper.node 加载失败）——不可行 |
| 5 | 票据：`loginService.getMachineGuid()` | ✅ 可用（32 位 hex），但 `updateTicket({a2,d2,d2Key})` 空票据挂起 |
| 6 | 票据：`TicketService.forceFetchClientKey` | ❌ cpp_impl 无效（TicketService 是空壳，3 方法） |
| 7 | **C++ RVA 激活链**（session-activate.node，复用 vehicle.cpp 创建+注册） | ❌ `FUN_180025d63`（创建 NTWrapperSession）**挂起**——激活链依赖 QQ 运行时状态 |

### 🔑 关键实证（探测发现）

1. **业务 service vs 基础 service 分水岭**：`getNodeMiscService()`（155 方法）/`getMSFService()`（11 方法）
   **有效**；`getMsgService()/getGroupService()/getBuddyService()/getTicketService()` **全 null**。
   → session 有部分 cpp_impl，但业务 service 挂载依赖「QQ 主进程协作 init」。
2. **`loginService` 35 方法**（getMachineGuid 可用）；`session` 89 方法（updateTicket/onDispatchPush 等）。
3. **wrapper 顶层无 session 单例**：`NodeIQQNTWrapperSession.get()` 返回 null（自建宿主无注册）。
4. **`forceFetchClientKey` 报 `cpp_impl is not valid`**——TicketService 需要 session 激活后才有效。

---

## 📌 产品路线影响（重要）

### 结论：自建宿主（路线 A）session READY = 硬墙

- 登录链路 ✅（stub 等价物 + O3Misc 激活 + 快速登录）
- **session 业务 service ❌**（cpp_impl 激活依赖 QQ 主进程/渲染进程协作，纯 Node 缺协作）
- C++ RVA 激活链（vehicle.cpp 的 FUN_180025d63 创建链）在纯 Node **挂起**——注入路线才有效

### 影响评估

| 路线 | 状态 | 说明 |
|---|---|---|
| **A. 自建宿主** | ⚠️ **session READY 硬墙** | 登录 ✅ 但业务 service 无法激活 → 无法收发消息 |
| **B. 注入 worker**（NapCat 同款） | ✅ **已验证兜底**（P2-0/P2-1） | worker 继承 QQ env → session READY 1s → 冒烟收发通过 |

### 下一步建议（按优先级）

1. **路线 B 作为产品路线的评估**：既然自建宿主 session READY 是硬墙，路线 B（注入 worker，
   已验证全链路）应回到主攻位置。需实测内存（HEADLESS 后百兆级？）。
2. **自建宿主 session READY 的深层研究**（若坚持路线 A）：
   - 研究 `FUN_180025d63` 挂起原因（是否依赖窗口消息/线程状态/全局单例初始化）
   - 或研究「QQ 主进程协作」的本质——自建宿主是否能模拟（非渲染进程，是登录服务状态机？）
3. **窗口类/无头阻断**：已确认窗口类非充分条件，可降级为环境模拟项（远期）。
4. **正式版 stub 已是产品化资产**：无论路线 A/B，自建宿主加载（标准 node + stub）都需要。

---

## 📁 实验文件清单（均在 `packages/loader/native-private/`，闭源 gitignore）

| 文件 | 作用 | 状态 |
|---|---|---|
| `stub-qqnt.cpp` | **正式版 stub 源码**（IsEnvironmentStopping + PerfTrace 空实现） | ✅ 核心产物 |
| `stub-qqnt.def` | 完整 stub 定义（100 条：99 静态 + PerfTrace） | ✅ compare-symbols.mjs 自动生成 |
| `QQNT-stub-full.dll` | 正式版 stub 产物（69KB） | ✅ 回归登录通过 |
| `stub-test-env/QQNT.dll` | 部署到测试目录（PATH 前置用） | ✅ |
| `power-window.cpp/.node` | Base_PowerMessageWindow 窗口类插件 | ✅ 编译通过，**非充分条件** |
| `session-activate.cpp/.node` | C++ RVA 激活链插件（复用 vehicle.cpp） | ❌ 自建宿主下 FUN_180025d63 挂起 |
| `p0-session-ready.mjs` | 登录 + session READY 验证（start/init/窗口类全路径） | ✅ 决定性 |
| `p0-ticket-probe*.mjs` | 票据探测（getMachineGuid/updateTicket/forceFetchClientKey） | ✅ 结论：票据非卡点 |
| `p0-session-service.mjs` | session service 分水岭探测（业务 vs 基础） | ✅ 关键实证 |
| `p0-session-activate.mjs` | 激活链集成验证 | ❌ 挂起 |
| `p0-module-probe.mjs` / `p0-activate-min.mjs` | 模块句柄/最小激活探测 | ✅ |

**运行方式**（PowerShell，会话内自研 stub 登录 + READY 验证）：
```powershell
cd packages\loader\native-private
$env:PATH = "C:\Dev\QQBot-Dev\NapukettoQQ\packages\loader\native-private\stub-test-env;C:\Dev\QQBot-Dev\QQNT\versions\9.9.33-51802\resources\app;" + $env:PATH
$env:NAPUTO_WRAPPER_PATH="C:\Dev\QQBot-Dev\QQNT\versions\9.9.33-51802\resources\app\wrapper.node"
$env:NAPUTO_QQ_VERSION="9.9.33-51802"
$env:NAPUTO_QUICK_UIN="3567141148"
node p0-session-ready.mjs
```
（注意：wrapper 后台线程干扰 stdout——日志写文件；QQ 进程存在时窗口类会被 FindWindow 跳过，
power-window 已强制注册覆盖。）

---

## 🧭 会话状态快照

- **git**：工作区干净（实验文件全部在 `native-private/` gitignore 内，无提交）
- **遗留**：实验结束清理 node 进程（`taskkill /F /IM node.exe`）
- **环境事实**：QQ 9.9.33-51802；llvm-mingw 工具链（见 HANDOVER-V7）；QQ 数据根
  `C:\Users\xiaoxiaochen\Documents\Tencent Files\`（nt_qq/global 才是 commonPath）；
  已验证快速登录账号：**3567141148（吉帕斯喵）**；3054108135 账号风控挂起勿用。
