# 交接：路线 B 定稿与全链路验证（V5，2026-08-06）

> **本文件是最新交接（V5）**。新对话开场先读：
> 1. 本文件（路线 B 定稿 + 已验证结论 + 下一步，最重要）
> 2. `docs/HANDOVER-V4-product.md`（V4 背景：双层路线 + P0 判定 + 历史资产）
> 3. `AGENTS.md`（V2 架构 + 红线，2026-08-06 已更新为 Native Bypass 混合模式）
> 4. `docs/architecture-v2-native-bypass.md`（V2 架构书）
> 5. `/memories/session/p0-verdict.md`（P0/P1/P2-0 全链路实验记录）

---

## 🏆 路线定稿（用户拍板 + 实测验证）

**路线 B（NapCat 同款：注入 QQ 主进程 → utilityProcess Worker）已定稿并全链路验证通过。**

```
pnpm start（apps/cli）
  └─ NapukettoBootMain.exe 拉起 QQ.exe + 注入 NapukettoWinBootHook.dll（自研 V1 资产）
  └─ hookdll IAT hook → 引导 boot.cjs（NAPUTO_ROUTE_B=1 分支）
  └─ boot.cjs fork utilityProcess Worker（继承 QQ env）→ route-b-worker.cjs
       └─ worker 内 process.dlopen(wrapper.node) → exports 98 个（QQ env 原生，无需 IAT 改写）
       └─ boot-bootstrap.js 复用 → kernel 装配 → 登录（快速/QR）→ session → 协议装配
  └─ 无头：阻断 UI/GPU/Renderer（vehicle.cpp 已有）；主进程保留但无窗口
```

**为什么路线 B 胜出**：路线 A（自建宿主 + env 兼容层）P0-B 判死——纯 Node 下 QQNT.dll 的事件分发对象（rdi+0x230 链表头）由 QQ 主进程 boot JS 创建，无人初始化 → 登录链路必然崩溃。路线 B 的 worker 继承 QQ env，该对象天然可用。

> **⚠️ 2026-08-06 深夜存疑（新对话第一件事）**：自建宿主判死可能不成立。研究 `C:\Dev\NapCat.Shell.Windows.Node1`（NapCat Shell Windows 部署包）后发现：**NapCat 也有纯 Node 自建宿主模式（node.exe ./index.js），无 QQ 进程无 UI，双进程仅 ~237MB，且能登录**（部署包自带 9.9.27 资源 + napi2native bypass 库）。
>
> **napi2native 真实职责（字符串分析实证）**：不是 env 兼容层！它是反风控/环境模拟：进程名伪装 QQ.exe、隐藏注入模块（K32EnumProcessModules/GetModuleHandleW hook）、内存 RWX→RX 伪装、创建 `Base_PowerMessageWindow`（QQ 窗口类，QQNT.dll 内部依赖窗口消息循环）、数据包层 hook（Frida Gum，可选）。
>
> **自建宿主失败的可能真相**：① 我们 P0-B 用 9.9.31 的 QQNT.dll（**登录服务已被腾讯下线**——后来升级 9.9.33 扫码才成功），崩溃可能是版本问题而非纯 Node 问题；② napi2native 创建的窗口类可能对登录有用（QQNT.dll 依赖窗口消息循环）；③ **未验证**：9.9.33 QQNT.dll + 纯 Node + 窗口类 + 票据能否登录。
>
> **验证实验（可决定性区分）**：9.9.33 资源 + 纯 Node dlopen + 建 Base_PowerMessageWindow + 已有票据登录。成功 → 自建宿主可救（百兆级可达）；失败 → 才是 env 硬墙。

---

## ✅ 已验证结论（全部实测，勿重复探索）

### P0-A：env 兼容层（✅ 成功，但路线 B 用不上）
- node.exe 导出 145 个 napi_*（推翻了「仅 3 个」旧结论）
- IAT 改写 wrapper.node 99/101 槽 → node.exe 标准实现 → 89 exports（= QQ 环境）
- **主注册函数 = FUN_180001000（RVA 0x1000）**，非旧记的 FUN_180b60da4（只注册 6 个 Guild）
- **定位**：降级存档（路线 B 直接继承 QQ env，不需要 IAT 兼容层）

### P0-B：登录链路（❌ 路线 A 判死）
- getLoginList/轮询回调崩：QQNT.dll +0x3E1E302（事件分发对象未初始化）
- 已穷尽排除：IAT 模式、session 激活链、TLS isolate 注入、qq_magic_node_register

### P1-1/1-2/1-3：路线 B 冒烟 + 落地（✅ 提交 0306226）
- 注入 9.9.31 → electron 37.1.0 + utilityProcess 可用；worker（type=utility）继承 QQ env
- boot.cjs 加 NAPUTO_ROUTE_B 分支（fork worker + 主进程存活，CJS 顶层 return）
- 新增 route-b-worker.cjs（worker dlopen → bootstrap）
- QR 二维码生成写盘 cache/qrcode.png + URL 打印

### P2-0：完整功能验证（✅ 试金石通过，提交 c42d20d）
- **卡点 1（appid）**：硬编码 537237765 在 9.9.33 扫码失败「请下载最新版」→ **从 major.node 提取真实 appid**（`QQAppId/` 标记后数字，9.9.33-51802 = **537376818**）→ 扫码成功
- **卡点 2（session）**：`new S()` 断言 cpp_impl invalid → **NapCat 方式**：`StartupSessionWrapper.create()` + `getNTWrapperSession("nt_1")`（带 cpp_impl）+ `startupSession.start()` → **getMsgService READY（1s）+ msgService 299 方法**（addKernelMsgListener/sendMsg/fetchMsgList 全在）
- 完整链路：扫码登录 → session init（onOpentelemetryInit is_init=true + onSessionInitComplete）→ service 挂载

---

## 📦 产品化状态（已提交，勿重复实现）

| 迁移项 | 位置 | 说明 |
|---|---|---|
| appid 动态解析 | `packages/kernel/src/wrapper-config.ts` | `parseAppidFromMajor(majorPath)`（读 major.node 的 QQAppId/ 标记）+ `resolveAppidQua(fullVersion, majorPath)` + `buildLoginConfig` 加 `externalVersion: false` |
| NapCat 式 session 创建 | `packages/kernel/src/wrapper-loader.ts` | `createSession`：StartupSessionWrapper.create() → getNTWrapperSession("nt_1") → create() 回退；`startSession` 优先 startupSession.start()；WrapperContext 加 startupSession 字段 |
| worker 引导 | `packages/loader/runtime/route-b-worker.cjs` | dlopen → bootstrap(state) 复用 |
| 路线 B 分支 | `packages/loader/runtime/boot.cjs` | NAPUTO_ROUTE_B=1 → fork worker + 主进程存活 |
| APPID 动态解析 | `packages/loader/runtime/boot-bootstrap.js` | 4 处硬编码 537237765 → 动态 APPID（parseAppidFromMajor 优先） |

**git 状态**：HEAD = `c42d20d`，工作区干净。提交链：`843dd04`（V1 注入基线）→ `0306226`（路线 B 落地）→ `c42d20d`（P2-0 产品化）。

---

## 🔥 下一步工作（按优先级）

### 0️⃣ 文档整理（2026-08-06 用户拍板：docs 已堆积成山，专项处理）
- [ ] 清理 docs/ 9 个文件 + 5 份 HANDOVER（V1~V5）+ 3 份 architecture 的过时内容
- [ ] 合并为一套：1 份现状文档（路线 B 定稿）+ 1 份决策史（V2/V3/V4 归档）+ 1 份架构书
- [ ] 整合本文件「⚠️ 自建宿主存疑」结论（影响路线决策，文档整理前先定）

### P2-1：kernel 在 worker 端到端跑通（功能最后一块）
- [ ] **收发消息实测**：worker 内用 kernel MsgBridge（addKernelMsgListener）+ MsgApi（sendMsg）真正发/收一条消息——业务层最后试金石
- [ ] **OneBot 装配**：adapter（OB11 HTTP/WS）+ network 启动验证
- [ ] **快速登录重试**：1006511 网络异常（NapCat waitForNetworkConnection：getMsfStatus !== 3 + 重试）

### P2-2：无头/低内存（验收标准 3/4）——⚠️ 决策待定
- [ ] **候选 A：自建宿主复活**（若存疑验证成功，百兆级，需绕过 napi2native 闭源）
- [ ] **候选 B：路线 B + main 替换**（注入后改 QQ main 阻止 UI，NapCat 注入模式做法，内存应降）
- [ ] **候选 C：维持路线 B + 事后抑制**（当前，600-700MB ❌ 用户已测，不可接受）

### P3：打磨
- [ ] 内存实测（无头 + 300MB 级目标）
- [ ] 多账号/进程隔离、supervisor 复用
- [ ] 版本兼容：wrapper-version.ts 探测 + appid 表维护（QQ 升级重跑 major 解析）

---

## ⚠️ 关键环境事实（务必记住）

- **QQ 已升级 9.9.33-51802**：`C:\Dev\QQBot-Dev\QQNT\`（wrapper.node 114MB，exports **98 个**）。旧 9.9.31 在 `C:\Program Files\Tencent\QQNT\`（登录服务已被腾讯下线，扫码「请下载最新版」）
- **appid 机制**：每版本从 major.node 的 `QQAppId/` 标记提取（NapCat parseAppidFromMajorV2 自研等价）。9.9.33-51802 = 537376818；9.9.31 = 537237765
- **session 必须 NapCat 方式**：`getNTWrapperSession("nt_1")` 或 `StartupSessionWrapper.create()`，**不要 `new NodeIQQNTWrapperSession()`**（cpp_impl 断言失败）
- **initConfig 必须 `externalVersion: false`**（扫码兼容）
- **commonPath 用 `getNTUserDataInfoConfig()` 返回路径的 `nt_qq/global`**（NapCat getDataPaths 语义），engine desktopGlobalPath 同
- **QQ 登录数据**：`C:\Users\xiaoxiaochen\Documents\Tencent Files\`（含 3054108135 等 7 个账号，nt_qq/nt_data/nt_db）

---

## 🚫 红线（两路线都适用）

1. **不抄 NapCat 代码**（Limited Redistribution License + napi2native 闭源）；只借鉴架构动作（注入 → utilityProcess → Worker dlopen），实现自研
2. **业务逻辑零逆向**：业务 100% 走官方 NAPI。禁 koffi/vtable/memcpy/thiscall 裸调
3. **零磁盘篡改**：内存 Patch 只在运行期 RAM；严禁改 QQ 安装目录二进制
4. **目的单一性**：C++ 逆向/Hook 仅用于「无头 + env 兼容」，业务不碰
5. **逆向产物不进公共仓库**：RVA 表/Offset 仅存本地/私有（scripts-tmp 已删除，含 QQ 票据）

---

## 🧹 已清理（V5 交接前）

- **`scripts-tmp/` 整目录已删**：含 QQ 登录票据（敏感）+ 全部探针/逆向脚本。核心逻辑均已产品化（见上表），无不可替代价值
- `.gitignore` 保留 `scripts-tmp/` 规则（防再建临时目录泄漏）

---

## 🌱 环境坑（复用历史，务必记住）

- **PowerShell PATH 间歇失效**：用绝对路径（python/g++/taskkill）
- **崩溃子进程占 DLL 句柄** → 编译 Permission denied → 杀残留 node 进程
- **wrapper.node 加载后进程不退出**（后台线程）→ 测试脚本需 process.exit
- **bootmain 拉起 QQ 后挂起** → async 模式 + 观察日志文件
- **desktop-commander（MCP）**可作 VS Code 终端替代（终端会坏/被卡死）
- **GhidraMCP 8080**：需 Ghidra GUI + 插件 HTTP 服务
