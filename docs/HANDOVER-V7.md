# HANDOVER-V7：自建宿主等价物研究（stub QQNT.dll 自研，2026-08-07 交接）

> **本文件是本次会话（2026-08-07 晚）的交接文档**，记录「napi2native 自研等价物」研究的第一块——
> **stub QQNT.dll 等价物已完成验证**（llvm-mingw 编译 + 完整登录链路通过）。
> 新对话先读 `docs/STATUS.md`（现状）→ `docs/architecture.md`（架构书）→ `docs/HANDOVER-V6.md`
> （自建宿主验证背景）→ 本文件。本文件位于 `docs/`（本地，gitignore），不随公共仓库分发。

---

## 🎯 本次会话核心结论（一句话）

**stub QQNT.dll 等价物验证通过（2026-08-07）**：用 llvm-mingw（clang + ld.lld）编译了一个
**70KB 的 PE Export Forwarding 空壳 DLL**（99 个符号：97 个 `forwarded to node.exe` + 1 个
`qq_magic_napi_register → node.exe.napi_module_register` + 1 个内部实现的
`?IsEnvironmentStopping@node@@...` 别名），替换 NapCat 闭源 stub（481KB）后**完整登录成功**
（dlopen 98 exports → O3MiscService → getLoginList 7 账号 → onLoginConnected →
quickLoginWithUin(3567141148) 成功）。**「napi2native 等价物」第一块拼图完成，产品化前置解除**。

---

## ✅ 等价物研究已完成验证（2026-08-07 决定性通过）

### 🏆 成功链路（自研 stub，全部实测）

```
系统 node v24 + PATH 前置 stub-test-env（自研 stub QQNT.dll，70KB）
  ├─ process.dlopen(9.9.33 wrapper.node) → ✅ 98 exports
  ├─ NodeIO3MiscService.get() + addO3MiscListener → ✅ 事件分发激活
  ├─ SSW.create() + getNTWrapperSession("nt_1") → ✅
  ├─ engine.initWithDeskTopConfig（desktopGlobalPath = 数据根/nt_qq/global）→ ✅
  ├─ loginService.initConfig（commonPath 同）→ ✅
  ├─ getLoginList() → ✅ 7 个账号
  ├─ connect() → ⚡ onLoginConnected 触发
  └─ quickLoginWithUin(3567141148) → ✅✅✅ 快速登录成功（result=0 errMsg=空）
```

### 🔑 关键技术数据（勿重复探索）

1. **wrapper.node 从 QQNT.dll 导入 99 个符号**（非 41 个！）：
   - `napi_*` × 40
   - `uv_*` × 56（libuv！之前 HANDOVER-V6 漏记）
   - `qq_magic_napi_register` × 1
   - v8/node mangled × 2（`?GetCurrent@Isolate@v8@@SAPEAV12@XZ` / `?IsEnvironmentStopping@node@@YA_NPEAVIsolate@v8@@@Z`）
2. **node.exe 缺失仅 2 个**（其余 97 个全有）：
   - `qq_magic_napi_register` → 转发 `node.exe.napi_module_register`（NapCat stub 同款）
   - `?IsEnvironmentStopping@node@@YA_NPEAVIsolate@v8@@@Z` → **stub 内部实现**（返回 false）+ mangled 别名导出
3. **llvm-mingw 的 `.def` 转发语法完全支持**（与 NapCat stub 格式一致）：
   ```
   LIBRARY QQNT.dll
   EXPORTS
       napi_call_function = node.exe.napi_call_function
       qq_magic_napi_register = node.exe.napi_module_register
       ?GetCurrent@Isolate@v8@@SAPEAV12@XZ = node.exe.?GetCurrent@Isolate@v8@@SAPEAV12@XZ
       ?IsEnvironmentStopping@node@@YA_NPEAVIsolate@v8@@@Z = IsEnvironmentStopping   ; 同 DLL 别名
   ```
4. **编译命令**（llvm-mingw）：
   ```
   clang++ -shared stub-qqnt.cpp stub-qqnt.def -o QQNT.dll
   ```
   源码 stub-qqnt.cpp 只需提供 `IsEnvironmentStopping(void*) → false`（+ 可选内部辅助）。
5. **运行方式**：PATH 前置 stub 目录 + 官方 `resources\app`（依赖 DLL 搜索），`process.dlopen(wrapper.node)`。
   **不再依赖 NapCat 部署包**（等价物目标达成）。

### ⚠️ 遗留小项（不影响登录，待补足）

- **`loadSymbolFromShell: GetProcAddress failed PerfTrace`**：wrapper 运行时动态 GetProcAddress 查
  `PerfTrace` 符号（不在静态导入表，llvm-objdump 看不到）——stub 未提供，登录链路不受影响。
  补足方向：搜索官方 QQNT.dll 的 PerfTrace 导出（`llvm-objdump -p QQNT.dll | grep PerfTrace`），
  确认后 stub 加 `PerfTrace` 转发/实现。**优先级低**（性能追踪功能，非核心链路）。
- **账号风控注意**：`quickLoginWithUin(3054108135)` 曾挂起（30s+ 无返回），换 `3567141148` 秒成功——
  **账号级风控，非 stub 问题**（同一 stub 不同账号结果不同）。测试用 `NAPUTO_QUICK_UIN=3567141148` 指定。

---

## 📁 实验文件清单（均在 `packages/loader/native-private/`，闭源 gitignore）

| 文件 | 作用 | 状态 |
|---|---|---|
| **`stub-qqnt.def`** | **完整 stub 定义（99 条转发，compare-symbols.mjs 自动生成）** | ✅ 核心产物 |
| `stub-qqnt.cpp` | stub 源码（提供 IsEnvironmentStopping 内部实现）——**用 stub-test.cpp 改** | 🔶 待整理正式版 |
| `stub-test.cpp` / `stub-test.def` | 最小可行性验证（7 符号转发 + 内部实现） | ✅ 验证通过 |
| `QQNT-stub-test.dll` | 最小验证产物（64KB） | ✅ |
| **`QQNT-stub-full.dll`** | **完整 stub 产物（70KB，99 条转发 + 内部实现）** | ✅ 决定性通过 |
| `stub-test-env/QQNT.dll` | 部署到测试目录的完整 stub（PATH 前置用） | ✅ 登录验证通过 |
| `compare-symbols.mjs` | 符号对比脚本（wrapper 导入 vs node.exe 导出 → 生成 stub-qqnt.def） | ✅ 复用工具 |
| `stub-symbols-analysis.txt` | 99 符号分类分析 + node.exe 缺失清单 | ✅ |
| `p0-login3.mjs` | 登录链路验证脚本（已加 NAPUTO_QUICK_UIN 支持） | ✅ 决定性通过 |

**运行方式**（PowerShell，自研 stub 登录验证）：
```powershell
cd packages\loader\native-private
# 编译（首次）
& "…\llvm-mingw-20260616-ucrt-x86_64\bin\clang++.exe" -shared stub-qqnt.cpp stub-qqnt.def -o stub-test-env\QQNT.dll
# 运行验证（PATH 前置自研 stub + 官方资源目录，指定已验证账号）
$env:PATH = "C:\Dev\QQBot-Dev\NapukettoQQ\packages\loader\native-private\stub-test-env;C:\Dev\QQBot-Dev\QQNT\versions\9.9.33-51802\resources\app;" + $env:PATH
$env:NAPUTO_WRAPPER_PATH="C:\Dev\QQBot-Dev\QQNT\versions\9.9.33-51802\resources\app\wrapper.node"
$env:NAPUTO_QQ_VERSION="9.9.33-51802"
$env:NAPUTO_QUICK_UIN="3567141148"
node p0-login3.mjs      # 期望：onLoginConnected → 快速登录成功
```

**工具链**：llvm-mingw 20260616-ucrt-x86_64
（`C:\Users\xiaoxiaochen\AppData\Local\Microsoft\WinGet\Packages\MartinStorsjo.LLVM-MinGW.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\llvm-mingw-20260616-ucrt-x86_64\bin`，
含 clang/clang++/ld.lld/llvm-objdump）

---

## 📌 下一步（按优先级）

### 1️⃣ 整理正式版 stub（0.5-1 天）
- [ ] `stub-qqnt.cpp` 正式版（从 stub-test.cpp 整理：只留 IsEnvironmentStopping + 头注释说明用途/合规边界）
- [ ] 版本兼容：QQ 升级后 wrapper.node 导入集可能变 → compare-symbols.mjs 重跑重新生成 def
- [ ] `PerfTrace` 补足（低优先级，见上）

### 2️⃣ session READY 验证（等价物之后，产品化关键）
```
登录成功 → getNTWrapperSession("nt_1").getMsgService() 是否 READY（非 null）
→ 是 → kernel/adapter 业务层 NAPI 复用 → 冒烟收发（boot-smoke.js 逻辑移植到自建宿主）
```

### 3️⃣ 内存实测（自建宿主定案指标）
```
标准 node + stub + wrapper.node + 登录态 → 实测内存
对照：路线 B（300MB+）→ 自建宿主应显著更低（百兆级）
```

### 4️⃣ 自建宿主落地（产品化）
- [ ] loader 新增自建宿主引导（替代路线 B 注入链路）：标准 node + stub + boot.cjs 复用
      （boot.cjs 的 NAPUTO_ROUTE_B 分支 → 新增 NAPUTO_SELF_HOST 分支，boot-bootstrap.js 完全复用）
- [ ] 窗口类 Base_PowerMessageWindow（napi2native 职责）：登录已成功可能已够用；host-helper.cpp 有
      现成实现可参考（闭源 native-private）
- [ ] 无头/低内存验收（P2-2 候选 A 达成）

### 5️⃣ 环境模拟剩余项（napi2native 其他职责，远期）
- 进程名伪装 QQ.exe、模块隐藏（K32EnumProcessModules/GetModuleHandleW hook）、RWX→RX 伪装——
  登录链路已验证不需要（当前标准 node 名即可登录），按需补足

---

## 🔬 背景速览（HANDOVER-V6 精华，勿重复探索）

- **自建宿主（路线 A）验证通过**（HANDOVER-V6）：纯 Node + 9.9.33 wrapper + stub QQNT.dll 转发 +
  O3MiscService 激活事件分发 → 完整登录成功。路线 A = 产品路线主攻。
- **三要素**：① 加载 = stub QQNT.dll 转发（napi_* → node.exe；host-helper IAT 方案弃用）
  ② `NodeIO3MiscService.get()` + `addO3MiscListener` 激活事件分发（否则 getLoginList 永不 resolve）
  ③ commonPath/desktopGlobalPath = `数据根/nt_qq/global` + session 先建 + getLoginList 在 connect 前。
- **NapCat stub（481KB，闭源）**：导出 3167 个转发符号（全套 v8/node/napi/uv），比自研 stub 全——
  但自研 stub 只需 wrapper.node 实际导入的 99 个（70KB 更小）。
- **host-helper.cpp（IAT 改写方案）已弃用**：能加载但事件分发不工作（getLoginList 挂起），
  保留文件供窗口类实现参考。

---

## 🧭 会话状态快照

- **git**：工作区干净（实验文件全部在 `native-private/` gitignore 内，无提交）
- **遗留**：实验结束清理 node 进程（`Get-Process node | Stop-Process -Force`）
- **环境事实**：QQ 9.9.33-51802 在 `C:\Dev\QQBot-Dev\QQNT`（wrapper 114MB，exports 98 个）；
  NapCat 部署包在 `C:\Dev\NapCat.Shell.Windows.Node1`（仅参考，已不依赖）；llvm-mingw 工具链见上；
  QQ 数据根 `C:\Users\xiaoxiaochen\Documents\Tencent Files\`（nt_qq/global 才是 commonPath）；
  已验证快速登录账号：**3567141148（吉帕斯喵）**
