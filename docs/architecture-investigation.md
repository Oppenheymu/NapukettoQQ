# QQ 9.9.31 Session 接入排查报告（2026-08-05）

> 本文档记录 NapukettoQQ 在 QQ 9.9.31-49919 上接入 `wrapper.node` Session 的完整排查过程与根因结论。
> 结论由多次真实注入实测（boot.log / hookdll.log / PowerShell 验证）+ NapCat 源码对照得出。
> **重要：本文档是「事实与结论」，不是待办清单——新对话先读本文档再动手，避免重复撞墙。**

---

## 1. 根因结论（用户已拍板接受）

### 1.1 核心结论

**QQ 9.9.31 主进程 JS 侧拿到的任何 `NodeIQQNTWrapperSession` 实例均为无 `cpp_impl` 的空壳。**

实测证据（多次注入，同一结论）：

| 尝试方式 | 结果 |
|---|---|
| `new NodeIQQNTWrapperSession()` | `init`/`getMsgService` 断言 `implementation of IQQNTWrapperSession is not valid` |
| `NodeIQQNTWrapperSession.create()` | 同断言失败（登录前后均无效） |
| Proxy 拦截 `new` 捕获的 QQ 自建 session | 登录前 `getMsgService` 可调返回 null；**登录后同一实例断言失败** |
| `get()` 静态方法 | 同断言失败 |
| 登录后替换为新捕获的 session | 快速登录成功路径下**无新捕获**（Proxy 拦截不到） |

**推论**：QQ 9.9.31 把 Session 的真实初始化（`cpp_impl` 实例化）**下沉到了渲染进程（Renderer）**，主进程仅作 IPC 转发节点。主进程 JS 侧持有的 session 对象只是「空壳句柄」。

### 1.2 用户拍板的路线决策（2026-08-05）

| 方向 | 判定 |
|---|---|
| **D：深挖渲染进程 / IPC 机制** | ✅ **主攻**。纯 Electron 官方 API（ipcMain/ipcRenderer），无逆向、合规 |
| **B：锁定 9.x 早期版本** | ✅ 保底退路。NapCat framework 在旧版可跑通 |
| **C：推翻死约束（shell 模式 + bypass）** | ❌ 坚决拒绝 |
| **A：逆向二进制 / NAPI 内部** | ❌ 坚决拒绝 |

---

## 2. 注入链路现状（已打通，勿重复排查）

| 环节 | 状态 | 证据 |
|---|---|---|
| BootMain 拉起 QQ + 注入 hook DLL | ✅ | `[boot] injected` |
| IAT hook 4/4（module_register/define_class/set_named_property/get_global） | ✅ | hookdll.log |
| boot JS 执行（napi_run_script）status=0 | ✅ | hookdll.log |
| dlopen 截获 wrapper.node exports（89 键） | ✅ | boot.log `CAPTURED wrapper.node exports (89)` |
| Proxy 拦截 QQ 构造器（session/loginService） | ✅ | `BOOT: 捕获 QQ session 实例（方法面 85）` |
| loginService.initConfig | ✅ | `loginService.initConfig OK` |
| **快速登录** | ✅ | `登录成功 uin=xxx uid=xxx nick=xxx` |
| **session 就绪（getMsgService 非 null）** | ❌ **卡点** | 轮询超时 |

### 2.1 已修复的历史 bug（勿回退）

1. **cli 误报「QQ 进程退出 code=0」**：BootMain 注入后 3 秒 `return 0`，cli 提前退出、QQ 变孤儿。
   ✅ 修复：BootMain `WaitForSingleObject(pi.hProcess, INFINITE)` 等 QQ 退出再返回。
2. **注入目标错误**：原 `findQqProcess` 取 PID 最大（可能命中用户已开的 QQ 实例）。
   ✅ 修复：优先 `pi.dwProcessId`，失败再快照兜底。
3. **登录前 `create()` 干扰 QQ**：15:21 实测 create() + 快速登录 → QQ 退出 code=0。
   ✅ 修复：登录前不碰 session（kernel `login` 登录成功后才处理 session）。

### 2.2 已知工程坑（勿浪费 Token 重查）

- `build-native.mjs` 偶发 node 崩溃导致 `dist/native/boot.cjs` 未更新 → 需手动 `Copy-Item packages\loader\runtime\boot.cjs packages\loader\dist\native\boot.cjs -Force`。
- kill 终端时 QQ 进程会变孤儿 → 手动 `Stop-Process -Name QQ`。
- read_file 对正在写入的 boot.log 有缓存 → 用 PowerShell `Get-Content -Raw` 读真实内容。

---

## 3. 根因证据链（NapCat 源码对照）

### 3.1 NapCat 两条路线（关键认知）

- **framework 模式**（`napcat-framework/napcat.cjs`）：`process.dlopen` 截获后
  `NodeIQQNTWrapperSession.create()` + `createServiceProxy`（Proxy 拦截 init 调用转发）。
  **这是旧版 QQ（9.x 早期）机制**，新版 QQ 已失效。
- **shell 模式**（`napcat-shell/` + `napcat-napi-loader/napiLoader.bat`）：
  **独立进程 + `Napi2NativeLoader` 原生 bypass**，这才是 NapCat 现役路线。

### 3.2 我们的死约束恰好排除 NapCat 现役方案

```
NapCat framework（旧）：登录前 create() → 有效（老 QQ 允许）
NapCat shell（现役）  ：独立进程 + Napi2NativeLoader bypass → 需要逆向 bypass
我们（9.9.31 新 QQ）  ：主进程 create/捕获 → 全部断言 cpp_impl 无效 ❌
```

**结论**：路线 A（NAPI 注入真实 QQ 主进程）在 9.9.31 上不能照搬 NapCat framework，
必须走**方向 D（IPC/渲染进程）**才能在合规约束内拿到有效 session。

### 3.3 为什么是渲染进程（架构推断）

QQ 9.9.31 防止主进程插件化，把 Session 生命周期下沉到 Renderer：

1. 真实带 `cpp_impl` 的 Session 存在于某个 Renderer 进程（或其 Worker）。
2. 主进程 = IPC 消息转发节点。
3. Electron 官方 API（`ipcMain`/`ipcRenderer`/preload）是合规的通信观测点。

---

## 4. 方向 D：IPC 探测计划（下一步）

### 4.1 目标

监听主进程 `ipcMain`，捕获渲染进程 → 主进程的 IPC 消息，定位驱动 `cpp_impl` 诞生的握手。

### 4.2 探测手段（纯 Electron API，合规）

```js
// boot.cjs 内（QQ 主进程，有最高 Node 权限）
const { ipcMain } = require('electron');
const origEmit = ipcMain.emit;
ipcMain.emit = function (channel, event, ...args) {
    if (/wrapper|session|nt/i.test(channel)) {
        log(`[IPC] ${channel} args=${JSON.stringify(args).slice(0, 500)}`);
    }
    return origEmit.apply(this, arguments);
};
```

### 4.3 探测问题清单

1. 渲染进程登录时向主进程发了哪些 IPC channel / payload？
2. 是否存在驱动 session 初始化的「IPC 握手」消息？
3. 能否通过模拟渲染进程的 IPC 消息激活主进程 session？
4. 主进程的 `ipcMain` 是否暴露了 session 相关处理器（`ipcMain.handle`）？

### 4.4 保底方案（方向 B）

若 IPC 探测证明 session 绑定在隔离上下文、无法间接调用：
- 回退验证 9.x 早期版本（NapCat framework 确定能跑通的最后版本，如 9.9.25 或更早）。
- 业务生态锁定稳定历史版本，优于破坏合规底线。

---

## 5. 会话记忆（session debug 关键事实，勿丢失）

- 登录前 `qqSession.getMsgService()` 可调（返回 null）→ 登录后断言失败。
- 快速登录成功路径下 Proxy **不**捕获新 session；QR 登录路径**会**捕获（方法面 86）。
- 原型 `init` 属性只读（`Cannot redefine property`）；静态 `getNTWrapperSession` 只读。
- `get()` 静态方法可被 JS 赋值 hook（但拿到的 session 也断言无效）。

---

## 6. 附：环境信息

- QQ 版本：9.9.31-49919（`C:\Program Files\Tencent\QQNT\QQ.exe`）
- Node（QQ 内 Electron）：v22.16.0 / electron 37.1.0
- wrapper.node exports：89 键
- 数据目录：`C:\Users\xiaoxiaochen\.napuketto\default`
- 日志：`napuketto-boot.log` / `napuketto-hookdll.log`（同数据目录）
