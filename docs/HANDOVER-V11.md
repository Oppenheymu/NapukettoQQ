# HANDOVER-V11：最终交接——🎉 业务基本实现，自建宿主唯一路线全链路跑通（2026-08-07）

> **本文件是自建宿主产品化阶段（V6→V10）的最终交接文本**，业务层已无遗留 TODO。
> **新对话开场顺序**：`docs/STATUS.md`（现状+决策点）→ `AGENTS.md`（工程指南+红线）→
> `docs/architecture.md`（架构书）→ **本文件（V11 最终交接）** → 对应包 `docs/design.md`。
> 需要背景时再读 V6~V10；需要路线演进史时读 `docs/DECISIONS.md`。

---

## 🎯 一句话现状（2026-08-07）

**业务基本实现**：kernel（12 apis + bridge + cache + login + 自建宿主适配）→ adapter
（onebot11 78 动作 + 事件翻译）→ network/media → loader 自建宿主引导 → cli 唯一启动方式
全部落地。**实测端到端**：`pnpm start` → 自动定位 QQ → 自建宿主登录 3567141148 →
session READY → 冒烟收发 → onebot11 adapter 启动 → **群消息真实接收并控制台打印**。
剩余工作：内存实测 + OneBot HTTP/WS 外部链路验证 + P3 打磨。

---

## ✅ 本次整理（2026-08-07，文档与代码对齐）

| 提交 | 内容 |
|---|---|
| `d253bfd` | fix(kernel): MsgListener.onRecvMsg 签名校准为消息数组（运行时实证）+ 控制台消息日志（**群消息真实接收**） |
| `0d9b769` | feat(cli): 路线 B 淘汰，自建宿主成为唯一启动方式（用户拍板，cli 默认 launchSelfHost） |
| `3a48844` | feat(loader): 自建宿主引导落地（NAPUTO_SELF_HOST 分支 + launchSelfHost）+ kernel 自建宿主适配（resolveQqGlobalPath / loginService 优先 get() / ensureLoginConnected / session 先建） |
| `ae180df` | docs: 最终交接 HANDOVER-V10（自建宿主登录 + session READY 全通） |
| `ea07ab4` | feat(kernel): session 初始化改为先 init 后 startupSession.start（V9 突破） |
| `a9eddc9` / `6724ef9` / `36c58e8` | docs: HANDOVER-V8 / V7 / V6 |

文档整理（本会话）：`STATUS.md`（刷新至业务基本实现阶段）、`DECISIONS.md`（追加 V7~V10 决策史）、
`architecture.md`（4.3 链路更新为实测最终形态）、`readme.md`（状态 + 启动说明）、本文件。

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

### 业务实现关键校准（d253bfd 实测）
- **onRecvMsg 回调参数是消息数组**（批量推送），不是单条——单条签名会导致 msg.msgId/elements 全 undefined

### 已证伪路径（勿再探索）
| 路径 | 结论 |
|---|---|
| host-helper IAT 改写 | 事件分发不工作 |
| 先 ssw.start() 再 init | 业务 service 不挂载 |
| init 后 startNT（非 startupSession.start） | 业务 service 不挂载 |
| C++ RVA 激活链（FUN_180025d63） | 纯 Node 挂起 |
| Base_PowerMessageWindow 窗口类 | 非必要（保留无害） |
| 进程名伪装 / 票据 updateTicket | 非卡点 |

---

## 🚀 下一步（按优先级，业务已实现）

1. **内存实测**（产品化验收指标）：标准 node + stub + wrapper + 登录态 → 对照路线 B 300MB+，目标百兆级
2. **OneBot 装配端到端**：adapter OB11 HTTP/WS 上报 + network 广播的完整外部链路验证（内部链路已通）
3. **P3 打磨**：多账号/进程隔离（supervisor 复用）、版本兼容（wrapper-version 探测 + appid 表维护）、
   数据包层（packet 后端，远期，逆向已解禁）

---

## 🗂️ 关键文件索引

| 文件 | 作用 |
|---|---|
| `docs/STATUS.md` | **唯一现状文档**（决策点 + 已验证结论 + 产品化状态 + 下一步） |
| `docs/architecture.md` | 架构书（分层 / ADR / 路线图 / 红线 / 工具链） |
| `docs/DECISIONS.md` | 决策史（V1→V10） |
| **`docs/HANDOVER-V11.md`** | **本文件（最终交接）** |
| `docs/HANDOVER-V6~V10.md` | 自建宿主阶段各分阶段记录（V10 为上一交接） |
| `packages/loader/native-private/README.md` | 闭源目录说明（stub-qqnt.cpp + 运行方式） |
| `packages/kernel/src/login/lifecycle.ts` | 已修正的 initAndStartSession（先 init 后 start） |
| `packages/loader/runtime/self-host.cjs` | 自建宿主入口（dlopen + O3MiscService 激活 + bootstrap 复用） |

---

## ⚠️ 环境事实

- **QQ 9.9.33-51802**：`C:\Dev\QQBot-Dev\QQNT`（wrapper 114MB，exports 98 个；9.9.27/9.9.31 登录服务下线勿用）
- **QQ 数据根**：`C:\Users\xiaoxiaochen\Documents\Tencent Files\`（nt_qq/global 才是 commonPath）
- **快速登录账号**：`3567141148`（已验证成功）；`3054108135` 账号风控挂起勿用
- **llvm-mingw**：WinGet Packages\MartinStorsjo.LLVM-MinGW.UCRT...\bin（clang++/ld.lld/llvm-objdump）
- **NapCat 源码**：`C:\Dev\QQBot-Dev\NapCatQQ-main`（机制参考，零复制——GPL-2.0 红线）
- 实验脚本日志写文件（wrapper 后台线程干扰 stdout）；实验结束清理 node 进程（`taskkill /F /IM node.exe`）

---

## 🏁 收尾说明

自 2026-08-05 项目启动到 2026-08-07，四天完成：架构（分层 + ADR 18 条）→ 业务层（kernel/
adapter/network/media 全实现）→ 注入/自建宿主两条路线验证 → **自建宿主唯一路线全链路跑通**。
业务层无遗留 TODO，剩验证/打磨。新对话从「内存实测」继续即可。
