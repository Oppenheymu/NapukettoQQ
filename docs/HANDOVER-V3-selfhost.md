# 交接：自建宿主路线（V3，2026-08-06 晚）

> **⚠️ 已被 V4 取代**：最终产品形态 + 路线定稿请看 **`docs/HANDOVER-V4-product.md`**（2026-08-06 深夜）。
> 本文件是「自建宿主可行性 + P0 bypass 实验」的详细结论，V4 决策依赖本文件。
> 新对话开场先读：
> 1. `docs/HANDOVER-V4-product.md`（最终产品形态 + 路线定稿）
> 2. 本文件（自建宿主 P0 结论，最重要）
> 3. `AGENTS.md`（V2 架构 + 红线已更新）
> 4. `docs/architecture-v2-native-bypass.md`（V2 架构书，已追加 §3.2.1 自建宿主）
> 5. `docs/HANDOVER-V2-reverse.md`（早期 Ghidra 逆向交接，背景参考）
> 6. `/memories/session/selfhost-bypass-p0.md`（P0 实验结论，已固化）

---

## 🏆 一句话结论（本次 session 的颠覆性突破）

**wrapper.node 不需要 QQ Electron——标准 Node 进程即可加载它并创建 session。**

实测证据链（全部在标准 Node v24.16.0，无 QQ UI）：
1. `LoadLibrary(QQNT.dll)` 成功（提供 v8/node/napi/qq_magic 全套宿主符号）
2. `LoadLibrary(wrapper.node)` 成功（常规导入自动绑定，绕过 Node self-register 检查）
3. koffi 调用 `CreateNTSessionShell("Session")` → **返回真实对象指针 `0x1faef126030`**
4. 激活链 `FUN_180025d63`（创建）+ `FUN_180025d9d`（注册）+ `FUN_180028756`（init，最小 SessionConfig）→ **全部调用成功无崩溃**

**2026-08-06 晚 P0 补充（本 session）**：`process.dlopen(wrapper.node)` 在纯标准 Node **成功**
（IAT hook GetProcAddress 拦 `napi_register_module_v1` 查询，不再 "did not self-register"）。
但 **NAPI exports 无法填充**（wrapper.node 的 napi_* 绑定 QQNT.dll 定制实现，需要 QQ 定制 env，
标准 Node env 不兼容 → 返回真实注册函数 FUN_180b60da4 会 0xC0000005 崩溃）。
**NapCat 能行是因为其 Shell Worker 是 Electron utilityProcess（QQ env），不是纯标准 Node。**
→ 自建宿主业务层推荐走 **koffi C++ ABI** 路线（详见 §8）。
5. 对象 vtable = `0x395c068`（RVA），在 wrapper.node `.rdata` 段（INTSessionShell vtable 同段）→ **对象真实有效**

---

## 1. 两条路线的现状与关系（重要澄清）

| 路线 | 现状 | 业务层方式 | 卡点 |
|---|---|---|---|
| **NAPI 注入**（生产在用） | 1.01GB 内存，登录成功，业务层 JS 可用 | boot.cjs 截获 NAPI exports → Proxy → 直接 JS 调用 | **session init 后 getMsgService=null** |
| **自建宿主**（新突破） | 标准 Node 独立进程，session 已可创建 | koffi 调 C++ ABI（暂）→ 待升级为 bypass+dlopen | **业务层尚未接通** |

**两者不冲突，最终合流**：自建宿主若打通「bypass + process.dlopen」，业务层与注入路线**完全共用**（都是 NAPI exports 截获 → boot.cjs）。
**⚠️ 2026-08-06 P0 修正**：bypass+dlopen 已验证成功，但 exports 截获在纯标准 Node 走不通（env 不兼容，见 §8），
自建宿主业务层实际需走 koffi 路线——「完全共用 boot.cjs」的假设需要修正。

---

## 2. 逆向事实链（全部实测验证，勿再重复探索）

### 2.1 wrapper.node 的导入结构（关键修正，早期文档写错过）
- `qq_magic_napi_register` 是 wrapper.node 对 **QQNT.dll 的常规导入**（Import Table，**不是 delay-load**！）
- wrapper.node 的 delay-load 表只有：avif_convert/QBar/opencv/LightQuic/ncnn
- wrapper.node 常规导入 QQNT.dll 的符号：全套 `napi_*` + v8 `Isolate@v8` + node `AsyncResource@node` + `qq_magic_napi_register` + libuv
- wrapper.node **无** `nm_register_func` / `napi_register_module_v1`（导出表仅 33 个 MSVC mangled 符号）

### 2.2 QQNT.dll = 可独立加载的宿主桥接层
- 导出：全套 `napi_*` + v8 `Isolate` 系列 + node `AsyncResource` 系列 + `qq_magic_napi_register`(ord 3021, RVA 0x1AFB720) + `qq_magic_node_register`(ord 3022, RVA 0x1B004F0)
- 导入极干净：仅系统 DLL + ffmpeg.dll，**无 node/electron/v8 依赖**
- 可独立加载（SetDllDirectory 到 QQ 版本目录后 LoadLibraryW 成功）

### 2.3 "Module did not self-register" 的真相
- 该错误来自**标准 Node 的 DLOpen**（C++ 层），它检查加载后能否 dlsym 到 `napi_register_module_v1`
- wrapper.node 没有 → Node 拒绝
- QQ 定制 Electron 的 dlopen 不检查这个，走 `qq_magic_napi_register` 注册
- **绕过方式：`LoadLibraryA` 直接加载（不经 process.dlopen）→ 常规导入自动绑定，无 self-register 检查**

### 2.4 自建宿主 DLL 搜索路径（关键前提）
```
C:\Program Files\Tencent\QQNT\versions\9.9.31-49919                    （QQNT.dll）
C:\Program Files\Tencent\QQNT\versions\9.9.31-49919\resources\app      （libvips-42.dll, crypto.dll, opencv.dll, ncnn.dll 等）
```
用 `SetDllDirectoryA` + PATH 环境变量注入。

---

## 3. 关键技术资产（scripts-tmp/，已 gitignore 忽略）

| 文件 | 作用 | 状态 |
|---|---|---|
| `scripts-tmp/qqnt-host-helper.cpp` | 标准 NAPI helper DLL：DllMain 加载 QQNT.dll + wrapper.node + 设置 PATH | ✅ 编译成功 |
| `scripts-tmp/host-test-v3.mjs` | 验证 LoadLibrary(wrapper.node) 成功 + CreateNTSessionShell 导出可解析 | ✅ |
| `scripts-tmp/host-test-v4.mjs` | koffi 调用 CreateNTSessionShell → 返回对象指针 | ✅ 突破 |
| `scripts-tmp/activate-v1.mjs` | koffi 裸地址调 FUN_180025d63 + FUN_180025d9d（创建+注册） | ✅ |
| `scripts-tmp/activate-v2.mjs` | 完整激活链 + init（最小 SessionConfig）无崩溃 | ✅ |
| `scripts-tmp/verify-object.mjs` | 对象 vtable 验证（RVA 0x395c068） | ✅ |
| `scripts-tmp/imp-analyze.py` | pefile 精确分析 wrapper.node 导入表 | ✅ 结论已固化 |
| `scripts-tmp/magic-observer.cpp` | 运行时观察 DLL（delay-load dump + qq_magic 槽检查） | ✅ |
| `scripts-tmp/qqnt-host-helper2.cpp` | **P0：IAT hook GetProcAddress（node.exe）+ 三种 stub 模式** | ✅ dlopen 成功 |
| `scripts-tmp/bypass-test.mjs` | P0 验证：dlopen(wrapper.node) + exports 检查（NAPUTO_STUB_MODE 0/1/2） | ✅ |
| `scripts-tmp/diag-mode2.mjs` | P0 崩溃诊断：mode=2（真实注册函数）分离进程 + 超时 | ✅ 确认 0xC0000005 |
| `scripts-tmp/napi-init-refs.txt` | wrapper.node 全量反汇编 napi_* IAT 引用（17520 块） | ✅ |
| `scripts-tmp/magic-callers.txt` | qq_magic_napi_register thunk 分析（**无调用者**） | ✅ |

**koffi 位置**：`node_modules\.pnpm\koffi@3.1.4\node_modules\koffi`（某包依赖，非直接依赖）
**真实 python**：`C:\Users\xiaoxiaochen\AppData\Local\Python\bin\python.exe`（3.14.6，WindowsApps 的是 MS Store stub 勿用）

---

## 4. koffi 3.x API 要点（与 V1 的 1.x 完全不同，勿踩坑）

```js
// 函数调用（符号名第一参数！不是 C 签名）
lib.func("符号名", "返回类型", ["参数类型", ...]);

// 裸地址调用（激活链内部函数用，基址+RVA）
const voidFn2 = koffi.proto("void", ["void *", "void *"]);
koffi.call(地址BigInt, voidFn2, arg1, arg2);

// 内存分配与读写
const p = koffi.alloc("char", 0x400);          // 双参数！
koffi.encode(p, "uint8_t[1024]", uint8array);
const arr = koffi.decode(p, "uint8_t[1024]");  // 返回可写 Uint8Array！
const val = koffi.decode(p, "uint64_t");

// MSVC x64 返回结构体（shared_ptr 16 字节）→ 返回缓冲指针是 rcx（第一参数），真参数在 rdx
// 所以 CreateNTSessionShell C 签名：void f(void* retPtr, void* str)
```

---

## 5. 激活链（vehicle.cpp 私有 RVA 表，勿进公共仓库）

```
FUN_180025d63 (RVA 0x25d63)  创建 NTWrapperSession：void f(void* ret容器, void* sessionId)
                             对象存 ret+0x00（shared_ptr）
FUN_180025d9d (RVA 0x25d9d)  注册进单例表：void f(void* key, void* shared_ptr)
                             第 2 参是 shared_ptr（16 字节 {对象, 控制块}），传 ret 本体
FUN_180028756 (RVA 0x28756)  init：void f(void* session, void* sessionConfig)
```

**SessionConfig 最小字段**（init 无崩溃的关键，实测验证）：
- `+0x268`：QQ std::string（非空，如 "Session"）
- `+0x280`：char = 1（启用标志，非 0 才执行 init）
- `+0x3f8`：char = 1（FUN_1800296ac 检查 +0x340 子对象的 +0xb8 需非 0，避免致命错误）

**QQ std::string**（32 字节 SSO）：
```
+0x00: buf[16]（SSO 短字符串：首字节 = 长度<<1，后续字符）
+0x10: size_t size
+0x18: size_t capacity（短字符串 = 0）
```

---

## 6. NapCat 最新版研究结论（main 分支，非 2024 版）——新方案的关键参考

**必须去看**：`https://github.com/NapNeko/NapCatQQ/tree/main`（已用 github_repo 工具读过）

### 6.1 Framework 模式（注入 QQ，与我们 boot.cjs 一样）
```js
// napcat.cjs
process.dlopen = function (module, filename, flags) {
  const dlopenRet = dlopenOrig(module, filename, flags);
  if (!filename.includes('wrapper.node')) return dlopenRet;
  wrapperNodeApi = module.exports;
  wrapperLoginService = wrapperNodeApi.NodeIKernelLoginService.get();
  wrapperSession = wrapperNodeApi.NodeIQQNTWrapperSession.create();
```
说明在 QQ 环境里 `create()` 可用（我们的注入路线卡点是 QQ 版本/时机差异）。

### 6.2 Shell 模式（关键！= 自建宿主 + NAPI 注入组合）
```
Master 进程（QQ 内注入）→ fork/utilityProcess → Worker 进程（独立子进程）
Worker 里：
  NAPCAT_PRELOAD_NODE_ADDON_PATH 预加载 napi2native 库（bypass）
  process.dlopen(wrapper.node)          ← 独立进程 dlopen 成功！
  wrapper.NodeIQQNTWrapperEngine.get()  ← NAPI 业务 API 免费可用
  wrapper.NodeIKernelLoginService.get()
  wrapper.NodeIQQNTStartupSessionWrapper.create()
  wrapper.NodeIQQNTWrapperSession.getNTWrapperSession('nt_1')
```

**⚠️ 2026-08-06 P0 实验修正认知（重要）**：NapCat Shell 的 Worker 是 **Electron utilityProcess**
（Master 是 QQ 内注入，fork 出的 Worker 继承 QQ 定制 Electron 运行时），**不是纯标准 Node**。
这解释了为什么 NapCat 的 Worker 里 `process.dlopen(wrapper.node)` 成功且 NAPI exports 完整可用——
**它的 env 是 QQ 定制 Electron 的 env，与 wrapper.node 的 napi_*（绑定 QQNT.dll 定制实现）兼容**。
而我们自建宿主用纯标准 Node 时 env 不兼容（详见 §8 P0 结论）。

### 6.3 Napi2NativeLoader（bypass 库，我们自研等价物）
```js
// napcat-core/packet/handler/napi2nativeLoader.ts
nativeModulePath = './native/napi2native/napi2native.' + platform + '.node'
process.dlopen(this.exports, nativeModulePath, RTLD_LAZY)  // 它是合法 NAPI 模块
...
napi2nativeLoader.nativeExports.enableAllBypasses?.(bypassOptions)  // 关键 bypass
napi2nativeLoader.nativeExports.initHook?.(send, recv)              // 数据包 hook
```

---

## 7. 新方案（自建宿主 = bypass + process.dlopen，比 koffi 方案优一个量级）

### 7.1 思路
NapCat Worker 用 `process.dlopen` + NAPI（不是 koffi 逆 vtable）→ 业务层全免费。
我们也这么做：**标准 Node + bypass 库 → `process.dlopen(wrapper.node)` 成功 → NAPI exports 截获 → boot.cjs 全套复用**。

**⚠️ 2026-08-06 P0 实测修正**：dlopen 成功 ✅（IAT hook GetProcAddress 即可），
但 **exports 截获在纯标准 Node 走不通**——wrapper.node 的 napi_* 绑定 QQNT.dll 定制实现，
需要 QQ 定制 env；标准 Node env 不兼容，调用真实注册函数直接 0xC0000005 崩溃。
NapCat 的 Worker 是 Electron utilityProcess（QQ env）才可用。**自建宿主业务层推荐 koffi 路线**。

### 7.2 具体实现（自研，零抄 NapCat）——已实测验证
标准 Node 的 dlopen 检查「加载后 dlsym `napi_register_module_v1`」。wrapper.node 没有 → 失败。
**方案：helper DLL hook `GetProcAddress`（或 `LdrGetProcedureAddress`），当对 wrapper.node 句柄查询该符号时返回 stub**：
```c
// stub：接收 env + exports，直接返回 exports
void* fake_register(void* env, void* exports) { return exports; }
```
→ Node 认为 wrapper.node 是合法 NAPI 模块 → dlopen 成功（**✅ 已实测**）。

**但注意**：stub 返回 exports 只是「dlopen 成功」；exports 内容是空的！
wrapper.node 的真实 exports 由内部注册函数 `FUN_180b60da4(env, exports)`（RVA 0xb60da4）构造，
它调 napi_define_class 等（绑定 QQNT.dll 定制实现）→ **标准 Node env 下崩溃 0xC0000005**。
只有拿到 QQ 定制 env 才能填充 exports（Electron utilityProcess 场景）。

### 7.3 验证成功的标志
```js
const m = { exports: {} };
process.dlopen(m, wrapperPath);   // 不抛 "did not self-register"
m.exports.NodeIKernelLoginService.get()  // 返回 loginService（非 null）
```

### 7.4 备选（P0 实测后的优先级修正）
1. **koffi C++ ABI（推荐，已验证）**：不依赖 NAPI exports，直接调 CreateNTSessionShell + 激活链。代价：业务层要逆 vtable 槽位，工作量大
2. 用 NapCat 的 napi2native 二进制逆向学习（红线：不抄代码，仅理解原理）——它解决的是「QQ env 下 dlopen 成功」，对纯标准 Node 未必有帮助
3. 构造 QQ 兼容 env（逆向 node_napi_env__ 布局 + 伪造）——高风险高难度
4. ~~修改 wrapper.node 导出表内存补槽~~——本 session 证明即使补上，注册函数也会因 env 不兼容崩溃，无意义

### 7.5 与注入路线的协同
- 注入路线：`boot.cjs` 截获 NAPI exports（QQ 主进程内）→ 业务层
- 自建宿主：**koffi C++ ABI 拿 session**（标准 Node 内）→ 业务层需另建桥（比 boot.cjs 重）
- 两条路线共用 kernel/adapter/network/media/cli，只换「拿 session 的方式」

---

## 8. 待办（新对话按优先级）

### ✅ P0 已做（2026-08-06 本 session）：self-register bypass 实验

**✅ 达成：`process.dlopen(wrapper.node)` 成功（不再 "did not self-register"）**
- 实现：`scripts-tmp/qqnt-host-helper2.cpp`——DllMain 加载 QQNT.dll + wrapper.node + PATH；
  NAPI_MODULE_INIT 里 **IAT hook node.exe 的 GetProcAddress**（findImportIatSlot 改
  kernel32!GetProcAddress 槽，改数据不改代码，不触发 CFG）
- Node 24.16.0 DLOpen 流程实测：`node_register_module_v137` → NULL →
  `napi_register_module_v1` → **被 hook 拦下返回 stub** → dlopen 成功
- 验证脚本：`scripts-tmp/bypass-test.mjs`；编译：LLVM-MinGW g++ + node-gyp 头文件

**❌ 未达成：`m.exports.NodeIKernelLoginService.get()` 非 null（标准 Node 走不通）**
- mode=0（stub 返回传入 exports）：dlopen 成功，exports 空
- mode=1（stub 转发 qq_magic_napi_register(env,exports)）：exports 空——
  反汇编确认 `qq_magic_napi_register` 是**单参数函数**（rcx），构造 napi_module 结构后
  tail-call `qq_magic_node_register`（注册到 TLS 槽 0x410），不是 (env,exports) 签名
- mode=2（hook 直接返回 wrapper.node 真实注册函数 **FUN_180b60da4**，RVA 0xb60da4）：
  **0xC0000005 崩溃**！
- **崩溃根因（决定性）**：wrapper.node 的 `napi_*` 导入绑定 **QQNT.dll 的定制 NAPI 实现**
  （期望 QQ 定制 env 布局）；标准 Node 的 env 结构不兼容 → FUN_180b60da4 内部调
  napi_define_class 即崩。node.exe 只导出 v8 C++ 符号，**不导出 napi_***
  （node.lib 有符号但那是链接期转发，node.exe 导出表仅 3 个 napi 相关）
- **结论**：纯标准 Node 无法填充 wrapper.node 的 NAPI exports（env 不兼容是硬墙）；
  NapCat 能做到是因为 Worker 是 Electron utilityProcess（QQ env）

### 待办（按优先级）
- [ ] P1：自建宿主业务层确定路线——
  **a) koffi C++ ABI**（host-v4 已验证 CreateNTSessionShell 返回真实对象，不依赖 NAPI，
  推荐）；b) 研究 NapCat napi2native 的完整 bypass（改 wrapper.node 的 napi_* 绑定或
  构造兼容 env）；c) 自建宿主嵌 Electron 运行时（复杂）
- [ ] P1：若走 koffi：登录流程（快速登录 -q / 扫码）在标准 Node 宿主下验证
- [ ] P1：SessionConfig 完整结构逆向（Ghidra，当前只知最小字段）——koffi 路线必需
- [ ] P2：注入路线的 init 卡点（getMsgService=null）用最小 SessionConfig 知识解（vehicle C++ 侧补 init）
- [ ] P2：kernel 恢复 koffi 依赖（若走 koffi 路线）

### 关键资产（scripts-tmp/，已 gitignore）
- `qqnt-host-helper2.cpp` + `qqnt-host-helper2.node`：GetProcAddress IAT hook（P0 核心）
- `bypass-test.mjs`：dlopen wrapper.node 验证（NAPUTO_STUB_MODE 0/1/2 三模式）
- `diag-mode2.mjs`：mode=2 崩溃诊断（分离进程 + 10s 超时）
- `napi-init-refs.txt`：wrapper.node 全量反汇编中 napi_* IAT 引用（17520 块）
- `magic-callers.txt`：qq_magic_napi_register thunk 分析（无调用者）

---

## 9. 环境坑（务必记住）

- **PowerShell PATH 间歇失效**：python/cmd/taskkill 时好时坏。用绝对路径：
  - python: `C:\Users\xiaoxiaochen\AppData\Local\Python\bin\python.exe`
  - taskkill: `C:\Windows\System32\taskkill.exe`
  - llvm-objdump: `C:\Users\xiaoxiaochen\AppData\Local\Microsoft\WinGet\Packages\MartinStorsjo.LLVM-MinGW.UCRT_...\bin\llvm-objdump.exe`
- **终端输出被管道吞**：避免 `| Select-Object` / `| Out-String` / 重定向，直接跑命令
- **bootmain 拉起 QQ 后挂起直到 QQ 退出** → spawnSync 会占终端；用 async 模式 + 观察日志文件
- **GhidraMCP 8080**：需要 Ghidra GUI 启动 + 插件 HTTP 服务；已接通（本 session 用过）
- **koffi 在 pnpm store**，不在 package.json；新对话若集成需 `pnpm add koffi`

## 10. git 状态

- 已提交：`843dd04`（gitignore）、`1be3b8a`（docs）、`db94973`（bootmain 格式化）
- 未提交：无（工作区干净）
- `scripts-tmp/` 和 `packages/loader/native/magic-observer.cpp` 已 gitignore
- **红线**：RVA 表 / Offset / 逆向产物绝不进公共仓库；`docs/` 下 V2 文档（含 RVA）保持本地
