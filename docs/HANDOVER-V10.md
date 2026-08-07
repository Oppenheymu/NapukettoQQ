# HANDOVER-V10：完整交接——自建宿主登录 + session READY 全通，进入产品化阶段（2026-08-07 深夜定稿）

> **本文件是本次会话（2026-08-07，V6→V9 全程）的最终交接文本**。会话上下文已满，新对话以此为准。
> **新对话开场顺序**：`docs/STATUS.md`（现状+决策点）→ `AGENTS.md`（工程指南+红线）→
> `docs/architecture.md`（架构书）→ **本文件（V10 交接）** → `packages/loader/native-private/README.md`
> （闭源目录说明）。需要细节时再读 V6/V7/V8/V9 各阶段文档。
> 本文件位于 `docs/`（本地，gitignore），不随公共仓库分发。

---

## 🎯 一句话现状（2026-08-07 深夜）

**自建宿主（路线 A）全链路打通：标准 node + 自研 stub QQNT.dll → 登录成功 → session 业务
service 全部 READY（getMsgService 298 方法）→ kernel 已修正落地。产品化前置全部解除，
下一步进入「自建宿主引导落地 + 冒烟收发 + 内存实测」。**

---

## 📌 本次会话成就清单（V6→V9，全部实测）

### 1. 自建宿主登录验证通过（V6，早）
- **纯 Node（系统 node v24）+ 9.9.33 官方 wrapper.node + stub QQNT.dll 转发 + `O3MiscService`
  激活事件分发 → 完整登录成功**（getLoginList 7 账号 → onLoginConnected → quickLoginWithUin 成功）
- 推翻 P0-B「自建宿主判死」——那是 9.9.31 版本问题（登录服务下线），非纯 Node 问题

### 2. 自研 stub QQNT.dll 等价物完成（V7，晚）
- llvm-mingw 编译 **69KB PE Export Forwarding stub**（替换 NapCat 闭源 stub 481KB）
- **99 符号**：napi_* ×40 + uv_* ×56 + qq_magic ×1 + v8/node mangled ×2
- node.exe 缺失仅 2 个：`qq_magic_napi_register`（→ node.exe.napi_module_register）、
  `?IsEnvironmentStopping@node@@...`（stub 内部实现返回 false）
- **产品化前置解除**——不再依赖 NapCat 部署包

### 3. 正式版 stub 整理（V8，深夜）
- `stub-qqnt.cpp` 正式版：IsEnvironmentStopping + **PerfTrace 空实现**（官方 QQNT.dll 有导出、
  NapCat stub 同款空实现实证；消除 GetProcAddress failed 日志）
- `compare-symbols.mjs` 加 PerfTrace 动态符号自动生成（def 100 条 = 99 静态 + PerfTrace）
- 回归登录通过

### 4. 🎉 session READY 突破（V9，深夜，决定性）
- **V8 误判「硬墙」→ V9 推翻**：关键 = **`session.init(config)` 之后调 `startupSession.start()`**
  （NapCat initializeSession 顺序）
- 此前失败原因：① 先 `ssw.start()` 再 init（顺序颠倒）② 或 init 后用 startNT（非 startupSession.start）
- **改正后 `onOpentelemetryInit(is_init=true)` 触发 → getMsgService READY（298 方法）+
  getGroupService/getBuddyService/getTicketService/getProfileService 全部有效**
- 隔离实验：O3 上报（setAmgomDataPiece/reportAmgomWeather）、UUID guid、deviceConfig 均非必要

### 5. kernel 落地（提交 `ea07ab4`）
- `lifecycle.initAndStartSession`：改为先 init 后 startupSession.start（有则 start()，否则 startNT 兜底）
- `wrapper-loader.startSession`：注释更新说明 V9 修正
- `boot-bootstrap.js`：激活路径改为直接走 initAndStartSession（弃用「先 start 后 READY」）
- **kernel 级实测**（p0-kernel-flow.mjs）：修正后 initAndStartSession + waitSessionReady 在自建宿主下完全通过

### 6. native-private 清理（深夜）
- 60+ 文件 → **12 核心文件 + `_archive/`（47 个历史实验归档）** + `README.md` 目录说明
- 已证伪路径全部归档：先 start 后 init、C++ RVA 激活链（session-activate）、进程名伪装、票据探测

---

## 🔑 关键认知（全部实测，勿重复探索）

### 登录链路三要素
1. **加载 = stub QQNT.dll 转发**（napi_* → node.exe，无需 IAT 改写；host-helper IAT 方案弃用）
2. **`NodeIO3MiscService.get()` + `addO3MiscListener`** 激活事件分发（否则 getLoginList 永不 resolve）
3. **commonPath/desktopGlobalPath = `数据根/nt_qq/global`**（不是数据根本身）

### session READY 四步（V9 决定性）
```
登录成功 → session.init(config, depends, dispatcher, listener) → startupSession.start()（先 init 后 start！）→ 等 onOpentelemetryInit(is_init=true)
```

### 已证伪路径（归档在 `_archive/`，勿再探索）
| 路径 | 结论 |
|---|---|
| host-helper IAT 改写 | 事件分发不工作 |
| 先 ssw.start() 再 init | 业务 service 不挂载（顺序颠倒） |
| init 后 startNT（非 startupSession.start） | 业务 service 不挂载 |
| C++ RVA 激活链（FUN_180025d63） | 纯 Node 挂起 |
| 进程名伪装（node 复制为 QQ.exe） | DLL init 失败 |
| 票据 updateTicket / forceFetchClientKey | 非卡点（NapCat 也用空票据） |
| Base_PowerMessageWindow 窗口类 | 非必要（保留无害） |

---

## 📦 已提交（git，master 分支）

| 提交 | 内容 |
|---|---|
| `ea07ab4` | **feat(kernel): session 初始化改为先 init 后 startupSession.start（V9 突破）** |
| `a9eddc9` | docs: HANDOVER-V8（硬墙记录）+ STATUS 更新 |
| `6724ef9` | docs: HANDOVER-V7（stub 等价物完成） |
| `36c58e8` | docs: HANDOVER-V6（自建宿主验证通过） |

工作区干净，`pnpm check` 全绿（158 文件）。

---

## 🚀 下一步（按优先级，V9 之后）

### ① 自建宿主冒烟收发（产品化关键）
- 登录 + session READY 后，MsgBridge + MsgApi 真发/收一条消息
- boot-smoke.js 逻辑移植到自建宿主链路（p0-napcat-flow 基础上 + kernel MsgApi）
- 目标 peer 用 `c2c:<自己的 uin>` 或 `group:<群号>`

### ② 内存实测（路线 A 定案指标）
- 标准 node + stub + wrapper.node + 登录态 → 实测内存占用
- 对照：路线 B（300MB+，注入 worker）→ 自建宿主应显著更低（百兆级目标）

### ③ loader 自建宿主引导落地（产品化）
- 新增 `NAPUTO_SELF_HOST` 分支（标准 node + stub + boot.cjs 复用）
- boot-bootstrap.js 完全复用（kernel 已修正 initAndStartSession）
- 无头/低内存验收（P2-2 候选 A 达成）

### ⏸️ 远期（环境模拟，按需）
- 进程名伪装、模块隐藏、RWX→RX——登录链路已验证不需要（当前标准 node 名即可登录）

---

## 🗂️ 关键文件索引

| 文件 | 作用 |
|---|---|
| `docs/STATUS.md` | 唯一现状文档（决策点 + 已验证结论 + 产品化状态） |
| `docs/HANDOVER-V10.md` | **本文件（最终交接）** |
| `docs/HANDOVER-V9.md` | session READY 突破细节 |
| `docs/HANDOVER-V8.md` | 硬墙误判记录（已被 V9 推翻，读 V9 即可） |
| `docs/HANDOVER-V7.md` | stub 等价物技术数据（99 符号分类） |
| `docs/HANDOVER-V6.md` | 自建宿主验证背景 |
| `packages/loader/native-private/README.md` | 闭源目录说明（核心产物 + 运行方式） |
| `packages/kernel/src/login/lifecycle.ts` | 已修正的 initAndStartSession |
| `packages/loader/runtime/boot-bootstrap.js` | 已修正的激活路径 |

---

## ⚠️ 环境事实

- **QQ 9.9.33-51802**：`C:\Dev\QQBot-Dev\QQNT`（wrapper 114MB，exports 98 个；9.9.27 登录服务下线勿用）
- **QQ 数据根**：`C:\Users\xiaoxiaochen\Documents\Tencent Files\`（nt_qq/global 才是 commonPath）
- **llvm-mingw**：WinGet Packages\MartinStorsjo.LLVM-MinGW.UCRT...\bin（clang++/ld.lld/llvm-objdump）
- **快速登录账号**：`3567141148`（吉帕斯喵，已验证成功）；`3054108135` 账号风控挂起勿用
- **NapCat 部署包**：`C:\Dev\NapCat.Shell.Windows.Node1`（仅参考，已不依赖）
- **NapCat 源码**：`C:\Dev\QQBot-Dev\NapCatQQ-main`（机制参考，零复制——GPL-2.0 红线）
- 实验脚本日志写文件（wrapper 后台线程干扰 stdout）
- 实验结束清理 node 进程（`taskkill /F /IM node.exe`）

---

## 🏁 收尾说明

本会话完成了「自建宿主从验证到 session READY 全通」的最后一公里。所有实验产物在
`native-private/`（闭源 gitignore，不随公共仓库分发）；公共仓库已提交的 kernel 修正与
文档是自建宿主产品化的基础。新对话从「下一步①冒烟收发」继续即可。
