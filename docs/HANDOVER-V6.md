# HANDOVER-V6：P0 自建宿主验证实验（2026-08-07 交接）

> **本文件是本次会话（2026-08-07）的交接文档**，记录 P0 验证实验的完整进展、技术细节与下一步。
> 会话上下文已满，新对话先读 `docs/STATUS.md`（现状）→ `docs/architecture.md`（架构书）→ 本文件。
> 本文件位于 `docs/`（本地，gitignore），不随公共仓库分发。

---

## 🎯 本次会话核心结论（一句话）

**自建宿主验证实验（决定性试金石）通过（2026-08-07）**：纯 Node（系统 node v24）+ 9.9.33 官方
wrapper.node + **stub QQNT.dll 转发** + `O3MiscService` 激活事件分发 → **完整登录成功**
（getLoginList 7 账号 → onLoginConnected → quickLoginWithUin 成功）。**「自建宿主可救」定案，
路线 A 为产品路线主攻**（百兆级内存），路线 B（300MB 注入）降级为兜底。

---

## ✅ 登录链路验证成功（2026-08-07 决定性试金石通过，路线 A 定案）

> **这是本会话最关键的突破**：`p0-login3.mjs` 在纯 Node（系统 node v24）+ 9.9.33 官方 wrapper.node
> 下完成**完整登录**：getLoginList 7 个账号 → onLoginConnected → quickLoginWithUin 成功。

### 🏆 决定性成功链路（p0-login3.mjs，全部实测）

```
系统 node v24 + PATH 前置 NapCat 部署包目录（提供 stub QQNT.dll）
  ├─ process.dlopen(9.9.33 wrapper.node) → ✅ 98 exports（stub QQNT.dll 转发 napi_* → node.exe）
  ├─ NodeIO3MiscService.get() + addO3MiscListener({getOnAmgomDataPiece(){}})  ← 🔑 激活事件分发！
  ├─ StartupSessionWrapper.create() + getNTWrapperSession("nt_1")  ← session 先建（engine init 前）
  ├─ engine.initWithDeskTopConfig（desktopGlobalPath = 数据根/nt_qq/global）
  ├─ loginService.initConfig（commonPath = 数据根/nt_qq/global）
  ├─ getLoginList() → ✅ 7 个账号（connect 前调用！）
  ├─ addKernelLoginListener + connect() → ⚡ onLoginConnected 触发
  └─ quickLoginWithUin(3567141148) → ✅✅✅ 快速登录成功（result=0 errMsg=空）
```

### 🔑 三个决定性认知（全实测，勿重复探索）

1. **加载方式 = stub QQNT.dll 转发，不是 host-helper IAT 改写**
   - NapCat 部署包 `QQNT.dll`（481KB）是**纯转发 stub**：所有 `napi_*` 导出
     `forwarded to node.exe.xxx`，`qq_magic_napi_register` → `node.exe.napi_module_register`
     ——wrapper.node 的 IAT 自动绑定到 node.exe 标准实现，**无需 IAT 改写**
   - **host-helper（LoadLibrary 官方 QQNT.dll + patch IAT + 调 FUN_180001000）虽能拿到 98 exports，
     但事件分发对象未初始化 → getLoginList/onLoginConnected 全部挂起**——已弃用
   - 系统 node v24 也能直接 dlopen（依赖 DLL 需在搜索路径：`resources\app` 下 crypto.dll/ssl.dll 等）
2. **`NodeIO3MiscService.get()` + `addO3MiscListener` 激活事件分发**（NapCat 序列关键步）
   - 此前所有探针（probe1-5）getLoginList 全部挂起（Promise 永不 resolve）——事件分发未初始化
   - 加上这步后 **getLoginList 首次 resolve**（probe6 实证，9.9.27；p0-login3 复现，9.9.33）
3. **commonPath / desktopGlobalPath = `数据根/nt_qq/global`**（不是数据根本身）
   - 数据根 `C:\Users\xiaoxiaochen\Documents\Tencent Files` → 0 个账号
   - `...\Tencent Files\nt_qq\global` → ✅ 7 个账号
   - NapCat `cEe` 实证：`[数据根, 数据根/nt_qq/global]`，engine 用 global，initConfig 用 global

### ⚠️ 待办（p0-login3 验证后的收尾）

- [ ] **自研 stub QQNT.dll 等价物**：NapCat stub 是闭源产物，只能验证不能分发。自研 = 编译一个
      导出 napi_*（转发到 node.exe）+ qq_magic_napi_register（转发到 node.exe.napi_module_register）
      的空壳 DLL（PE Export Forwarding，工具链已有 llvm-mingw）。这是产品化前必须的
- [ ] session 验证：登录成功后 getNTWrapperSession("nt_1").getMsgService() 是否 READY
- [ ] 内存实测：自建宿主（标准 node + wrapper + stub）实际占用
- [ ] 移除 host-helper.cpp 依赖（IAT 改写方案已弃用），保留文件供参考

---

## 📁 实验文件清单（均在 `packages/loader/native-private/`，闭源 gitignore）

| 文件 | 作用 | 状态 |
|---|---|---|
| `host-helper.cpp` | **核心 C++ helper**（NAPI 模块）：LoadLibrary(QQNT.dll) → 建窗口类 → LoadLibraryEx(wrapper.node) → IAT 改写 → 调 FUN_180001000 → 返回 exports | ⚠️ 已弃用（事件分发不工作） |
| `host-helper.node` | 编译产物（735KB，llvm-mingw g++ 编译） | ⚠️ 已弃用 |
| `p0-verify.mjs` | 第一步验证：加载链 → 98 exports | ✅ 通过 |
| `p0-verify2.mjs` | 第二步验证：核心对象可用性（engine/loginService/session/util） | ✅ 通过（stdout 干扰误报，实际成功） |
| `p0-login.mjs` | 登录链路验证（host-helper + 快速登录） | ❌ getLoginList 挂起 |
| `p0-login-probe1-5.mjs` | 逐步定位挂起点 | ✅ 定位出事件分发根因 |
| `p0-login-probe6.mjs` | NapCat 部署包环境 + O3MiscService | ✅ getLoginList 首次 resolve |
| `p0-login2.mjs` | host-helper + O3MiscService 版 | ❌ 仍挂起（host-helper 路径弃用） |
| **`p0-login3.mjs`** | **stub 转发 + O3MiscService + 快速登录** | ✅✅✅ **决定性通过** |
| `p0-exports-keys.json` | 98 个 exports 键清单 | ✅ |
| `p0-object-shapes.json` | engine/loginService 方法形状 | ✅ |
| `p0-login*.log` | 各 probe 文件日志（stdout 干扰规避） | ✅ |
| `napuketto-host-helper.log` | helper 运行日志 | ✅ |
| `analyze-napcat*.mjs` / `napcat-analysis*.txt` | NapCat 部署包逆向分析（仅参考，零引入） | ✅ |

**运行方式**（PowerShell，p0-login3 决定性脚本）：
```powershell
$env:PATH = "C:\Dev\NapCat.Shell.Windows.Node1;C:\Dev\QQBot-Dev\QQNT\versions\9.9.33-51802\resources\app;" + $env:PATH
$env:NAPUTO_WRAPPER_PATH="C:\Dev\QQBot-Dev\QQNT\versions\9.9.33-51802\resources\app\wrapper.node"
$env:NAPUTO_QQ_VERSION="9.9.33-51802"
node p0-login3.mjs      # 决定性试金石（需 PATH 含 NapCat 目录提供 stub QQNT.dll）
```
（p0-verify / p0-verify2 用 host-helper，需 NAPUTO_CFG_DIR/QQ_DIR/WRAPPER_PATH 三变量）

---

## 🔬 host-helper.cpp 技术方案（完整链路）

```
标准 Node 进程
  ├─ require(host-helper.node) → Node 调用 napi_register_module_v1（env = 标准 Node）
  │    ├─ LoadLibraryEx(QQNT.dll, LOAD_WITH_ALTERED_SEARCH_PATH)   → 宿主符号
  │    ├─ initPowerWindow()  → 注册 Base_PowerMessageWindow + 消息循环线程
  │    ├─ LoadLibraryEx(wrapper.node, LOAD_WITH_ALTERED_SEARCH_PATH) → 常规导入自动绑定
  │    ├─ patchWrapperIat()  → 遍历 import 表，QQNT.dll 的 napi_* 槽改写为 node.exe 实现
  │    └─ 调 FUN_180001000（RVA 0x1000）→ exports 填充（98 个）
  └─ 返回 exports → JS 侧直接使用
```

**关键实现细节**：
- **DLL 依赖路径**：QQNT.dll 在 `versions/9.9.33-51802/`，wrapper.node 的第三方依赖
  （libvips-42/libglib-2.0-0/libgobject-2.0-0/avif_convert/QBar/opencv/LightQuic/ncnn/broadcast_ipc）
  在 `resources\app\` 下——**必须用 `LOAD_WITH_ALTERED_SEARCH_PATH`**，普通 LoadLibrary 报 err=126
- **IAT 改写**：遍历 wrapper.node 导入表，只改 `QQNT.dll` 条目下 `napi_*` 前缀的槽
  （9.9.33 共 **40 个**），改指向 node.exe 的 `GetProcAddress(hNode, name)` 实现
- **主注册函数**：`FUN_180001000`（RVA 0x1000），签名 `napi_value(napi_env, napi_value)`，
  内部调用 5 个子注册函数（Ghidra 实测，含 0x180b60da4 旧记函数）
- **窗口类**：`Base_PowerMessageWindow`（napi2native 同款）——本次运行显示
  `already exists, skip`（因为 QQ.exe 当时在运行），**尚未验证 QQ 关闭时自建窗口类是否满足依赖**

---

## ✅ 已验证事实（9.9.33-51802，勿重复探索）

1. **wrapper.node 导入表**：40 个 napi_* + 1 个 qq_magic_napi_register，均来自 QQNT.dll；
   第三方 DLL 依赖 10 个（见上）
2. **QQNT.dll 导出**：148 个 napi_* + 24 个 node_* + 2 个 qq_magic（qq_magic_napi_register /
   qq_magic_node_register）——可独立加载的宿主桥接层
3. **node.exe 导出**：全套 napi_*（标准 NAPI，GetProcAddress 可解析）
4. **P0-A 结果**：`napi slots patched: 40` → `wrapper register called` → **98 exports**
   （与路线 B worker 完全一致：NodeIQQNTWrapperEngine / NodeIKernelLoginService / NodeIQQNTWrapperSession /
   NodeQQNTWrapperUtil / NodeIQQNTStartupSessionWrapper 全在）
5. **err=126 陷阱**：wrapper.node 依赖 DLL 必须用 LOAD_WITH_ALTERED_SEARCH_PATH 才能解析
   （普通 LoadLibrary 在标准 Node 下失败）

---

## ✅ 已解决：p0-verify2.mjs「无输出」（原待诊断问题）

**不是崩溃**——脚本实际执行成功（p0-object-shapes.json 完整写入），stdout 被 wrapper 后台线程
干扰（MMKV 等 C++ 日志直接打到 stdout，覆盖 JS console.log 输出）。
- 诊断方法：日志写文件（appendFileSync）而非 console.log，从文件读取真实进度
- 所有 probe 脚本沿用此模式（`p0-login*.log` 文件日志）
- **遗留注意**：wrapper 加载后进程不退出（后台线程）→ 脚本结束必须 `process.exit`；
  host-helper 加载官方 QQNT.dll 时 MMKV 日志刷屏（stub 转发方式干扰较少）

---

## 📌 下一步（按优先级）

### 1️⃣ 自研 stub QQNT.dll 等价物（产品化前置，1-2 天）
```
自研 = PE Export Forwarding 空壳 DLL（llvm-mingw 可编）：
  - 导出 40+ napi_* → forwarded to node.exe.<name>（与 NapCat stub 同机制）
  - 导出 qq_magic_napi_register → forwarded to node.exe.napi_module_register
  - 不复制 NapCat 代码（转发机制是 PE 标准特性，自研实现）
验证：p0-login3.mjs 改用自研 stub（去掉 NapCat 目录 PATH 依赖）→ 同样登录成功
```

### 2️⃣ session READY 验证（p0-login3 登录成功后）
```
登录成功 → getNTWrapperSession("nt_1").getMsgService() 是否 READY
→ 是 → 业务层 NAPI 复用（kernel/adapter 零改动）→ 冒烟收发测试
```

### 3️⃣ 内存实测（自建宿主定案指标）
```
标准 node + stub + wrapper.node + 登录态 → 实测内存
对照：路线 B（300MB+）→ 自建宿主应显著更低（百兆级）
```

### 4️⃣ 自建宿主落地（验证通过后）
- [ ] loader 新增自建宿主引导（替代路线 B 的注入链路）：标准 node + stub + boot.cjs 复用
- [ ] 窗口类 / 环境模拟（napi2native 自研等价物）按需补足（登录已成功，可能已够用）
- [ ] 无头 / 低内存验收（P2-2 候选 A 达成）

---

## 🧩 NapCat 部署包情报（C:\Dev\NapCat.Shell.Windows.Node1，仅作架构参考，零引入）

- **napi2native.win32.x64.node（2.9MB 闭源）**：反风控/环境模拟（进程名伪装、模块隐藏
  K32EnumProcessModules/GetModuleHandleW、RWX→RX、Base_PowerMessageWindow 窗口类）+ Frida Gum
  数据包 hook（send/recv RVA，版本表见 napcat.mjs `xQ` 常量，如 9.9.27 = send 0A697CC, recv 1E86AC1）
- **NapCat 纯 Node 加载**：`process.dlopen(this.exports, napi2native.<plat>.<arch>.node, RTLD_LAZY)`
- **QQNT.dll stub（481KB，2026-08-07 新发现）**：部署包根目录自带的**转发 stub**——导出表全部
  `forwarded to node.exe.*`（napi_* / node_* / qq_magic_*），wrapper.node 的 napi 导入自动绑定到
  node.exe 标准实现。**这是 NapCat 纯 Node 模式能在标准 node 下加载 wrapper.node 的关键**，
  与 host-helper 的 IAT 改写等价但走标准 NAPI 注册路径（事件分发正常）
- **NapCat 核心结构**（napcat.mjs，业务层可参考但零复制）：
  - `CV`：客户端容器（msgConverter / napcore / logger / client(NativePacketClient) / highway / operation）
  - `IV`（operation）：各种 oidb 操作（SendPoke / GroupSign / ImageOCR / FetchRkey / 群文件/闪传/转发等）
  - `XV`（eventWrapper）：callNormalEventV2（service 调用 + listener 回调 + 超时）
  - `xV`（logger）：winston 封装（console + file）
  - `VV`：NTQQ 加密数据库解密（node:sqlite + SQLite header 解密，dpapi）
- **NapCat 启动序列（2026-08-07 逆向分析）**：
  ```
  dlopen wrapper.node → enableAllBypasses（napi2native，可选）→ O3MiscService.get()
  + addO3MiscListener → engine.get()/loginService.get() → SSW.create() + getNTWrapperSession("nt_1")
  → engine.initWithDeskTopConfig（desktopGlobalPath=数据根/nt_qq/global）→ initConfig（commonPath 同）
  → getLoginList（connect 前）→ connect → onLoginConnected → 快速登录/QR
  ```

---

## 🧭 会话状态快照

- **git**：工作区干净（本次实验文件全部在 `native-private/` gitignore 内，无提交；`docs/HANDOVER-V6.md` 已更新）
- **遗留**：实验结束需清理 node 进程（`Get-Process node | Stop-Process -Force`）；
  p0-login3 可能残留快速登录后的会话进程
- **环境事实**：QQ 9.9.33-51802 在 `C:\Dev\QQBot-Dev\QQNT`；NapCat 部署包在
  `C:\Dev\NapCat.Shell.Windows.Node1`；llvm-mingw 工具链在
  `C:\Users\xiaoxiaochen\AppData\Local\Microsoft\WinGet\Packages\MartinStorsjo.LLVM-MinGW.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\llvm-mingw-20260616-ucrt-x86_64\bin`
