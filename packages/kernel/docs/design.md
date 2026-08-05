# @napuketto/kernel 设计

> 职责：**唯一原生交互层 + 唯一共享状态层**。协议层只认识 kernel，不认识 QQ。
> 对应 ADR：001 / 003 / 006 / 007 / 008 / 009 / 010 / 012 / 016 / 017 / 018
> 状态：P0-1 已完成（errors / paths / logger / config，2026-08-04，见 §8.3）；P0-2 已完成（event-channel + 占位 Listener 类型，2026-08-04，见 §4.1）；P1-1 已完成（wrapper-version + wrapper-loader，2026-08-05，见 §8.4）；P1-2 探测完成（RTTI 继承树 + service 类名/方法签名大全，2026-08-05，见 §8.5）；**P1-3 路线定稿：NAPI 范式重构（2026-08-05，见 §8.6）——wrapper-loader 从 koffi 改为 NAPI bootstrap，loader 包负责注入引导，业务层全走 NAPI；startNapuketto 装配入口 + smoke-test 已补（2026-08-05）；全链路实测打通（注入→IAT hook→boot JS→89 exports→startNapuketto OK）。** P1-4 设计定稿：QQ 进程内探测 + session 复用（2026-08-05，见 §8.7）；P1-5 装配层完成（core + context，2026-08-05，见 §8.8）；**P2-1 apis/msg 实现（2026-08-05，见 §8.9）——sendMessage / recallMessage / fetchMessages / markRead + canonical→NT 发送元素映射（text/at/face/image/voice/reply 核心五类）。** P2-2 消息事件链路完成（MsgBridge + toCanonicalElements，2026-08-05，见 §8.10）。

---

## 1. 边界

- **做**：加载 wrapper.node、注册原生 listener、维护缓存、暴露语义化 API 与事件通道、登录状态机、配置/路径/日志基础设施。
- **不做**：协议语义（OB11 等）、传输（HTTP/WS）、媒体转码、UI、framework 模式。

## 2. 目录结构

```
packages/kernel/src/
├── types/                    # 运行时探测产物（自研描述，非移植）
│   ├── wrapper.ts            # WrapperNodeApi / NodeIQQNTWrapperSession / NodeQQNTWrapperUtil
│   ├── services/             # 30+ NodeIKernel*Service 签名
│   ├── listeners/            # 12+ NodeIKernel*Listener 回调签名
│   ├── entities/             # RawMessage / Peer / ChatType / GroupInfo / GroupMember / SelfInfo ...
│   └── message-element.ts    # canonical 消息元素模型（协议无关，ADR-008 延伸）
├── wrapper-loader.ts         # dlopen + 加载（wrapper.node 路径来自 wrapper-version）
├── wrapper-version.ts        # QQ 版本探测：版本号/appid/qua/wrapper 路径（ADR-018）
├── event-channel.ts          # 类型化事件通道（ADR-003）
├── errors.ts                 # KernelError + KernelErrorCode（ADR-017）
├── apis/                     # msg / group / friend / user / file / system（统一错误语义）
├── cache/                    # group / member / friend / profile（主动同步 + 惰性回填 + 只读消费）
├── core.ts                   # NapukettoCore：装配 + 启动
├── context.ts                # CoreContext（只读装配根）
├── login.ts                  # QR 登录流程编排 + 状态机 + selfInfo（不含 UI 渲染）
├── logger.ts                 # pino 封装（console + file + level + redact）
├── config.ts                 # ConfigBase（zod 校验 + JSON 读写；协议 schema 放各协议包）
└── paths.ts                  # PathWrapper（binary/logs/config/cache 目录）
```

依赖：`pino`（替换占位的 consola）、`koffi`（FFI，P1 调 wrapper.node C++ ABI）。（`@napuketto/media` 不进 kernel，保持纯净，见 ADR-011）

> **kernel 禁止模块级全局单例**（ADR-015 推论）：logger / cache / event-channel 都必须是实例化对象，由 CoreContext 持有——多账号多进程场景下每进程一份，避免跨账号状态污染。

## 3. 类型层：运行时探测策略（ADR-006）

团队无逆向经验，也不需要——加载 wrapper.node 后运行时反射即可：

1. **枚举 API 面**：`Object.getOwnPropertyNames(Object.getPrototypeOf(session))` → 得到全部 `get*Service()`；再对每个 service 实例原型枚举方法 → 得到全部服务方法签名。据此写 `wrapper.ts` 与 `services/`。
2. **枚举实体形状**：登录后收发一条消息、拉一次群列表，把返回对象全量 JSON 序列化打日志 → `entities/` 类型据此"长"出来。
3. **理解语义**：字段含义（如 `msgId` vs `msgSeq`）可参考公开资料（含 NapCat 文档/类型作为"说明书"），**只帮助理解，不复制代码**。

探测脚本放 `packages/kernel/scripts/probe/`（`probe-services.ts`、`probe-entities.ts`），产物提交进 `types/`。

## 4. 事件通道（ADR-003）

```ts
// 事件名约定 "Msg/onRecvMsg"，签名从 Listener 接口编译期推导
type ListenerEvents<T> = {
    [K in keyof T as `${ListenerName<T>}/${K & string}`]: T[K];
};

class NTEventChannel extends EventEmitter {
    // 推送：订阅（每个 Service 只注册一次原生监听；core 缓存维护与协议翻译都订阅这里）
    on<E extends keyof ListenerEvents<MsgListener>>(
        event: E,
        handler: ListenerEvents<MsgListener>[E] & ((...a: never[]) => void),
    ): () => void;  // 返回 unsubscribe

    // 请求-响应桥：注册临时监听 → filter → 超时自动清理（替代 NapCat 的魔法字符串方案）
    waitFor<E extends keyof ListenerEvents<MsgListener>>(
        event: E,
        opts?: { filter?: (...args: Parameters<ListenerEvents<MsgListener>[E]>) => boolean; timeout?: number },
    ): Promise<Parameters<ListenerEvents<MsgListener>[E]>>;
}
```

要点：
- 事件名写错 → 编译期报错（类型推导）。
- 必须带 `'error'` 事件兜底，`waitFor` 默认超时并自动清理，防监听器泄漏。
- 不用 RxJS / 异步中间件链；EventEmitter 同步派发即可满足单进程消息量级。

### 4.1 P0-2 实现记录（2026-08-04）

`event-channel.ts` 已实现，通过 `pnpm check` + 9 项运行时冒烟测试（订阅/退订、waitFor/filter/超时清理、error 兜底、实例隔离）。关键决策：

- **组合实现而非 extends EventEmitter**：EventEmitter.on 返回 `this`，与「on 返回 unsubscribe」的设计冲突；组合（内部持有 emitter 实例 + `setMaxListeners(0)` 关默认上限）更干净，且符合「kernel 无全局单例、实例化对象」精神。
- **类型推导用 Extract 而非索引访问**：`ListenerEvents<L, Name>[E]` 在泛型下会扩宽为 string|number|symbol 索引（索引出 unknown），改用 `Extract<{ name, fn } 联合, { name: E }>["fn"]` 按事件名精确提取 handler / 参数类型（条件类型 infer），实例化后签名精确。
- **Listener 形状约束**：`ListenerShape = Record<string, unknown>` 宽约束 + 属性式方法声明（`onRecvMsg: (msg) => void`，useConsistentMethodSignatures 规范）。
- **占位 Listener 类型**：`types/listeners/msg.ts`（MsgListener：onRecvMsg/onRecvMsgReadReport/onRecvMsgReceipt）与 `types/entities.ts`（RawMessage/Peer/RawElement 最小占位）为探测产物雏形，字段待 `scripts/probe/` 产出后替换（勿以占位为准）。
- **错误语义统一**：waitFor 超时抛 `KernelError('TIMEOUT')`（ADR-009/017），协议层无需解析错误逻辑。
- **biome 命名配置**：`useNamingConvention` 关闭 strictCase（保留 `NTEventChannel` 等原生 NT 前缀连续大写命名，与 wrapper 接口 `NodeIQQNTWrapperSession` 等一致）。

## 5. apis：统一错误语义（ADR-009 / ADR-017）

- 内部解包原生 `{ result, errMsg }`：成功返回纯业务值，失败抛类型化 `KernelError`。
- 错误码分类（P1 探测真实错误返回后再增删）：

```ts
// errors.ts
type KernelErrorCode =
    | 'SEND_FAILED'       // 发送失败（原生拒绝）
    | 'PERMISSION_DENIED' // 无权限（禁言、非管理员等）
    | 'NOT_FOUND'         // 目标不存在（群/成员/消息）
    | 'TIMEOUT'           // 操作超时（含文件预测超时）
    | 'NOT_LOGIN'         // 未登录或已掉线
    | 'INVALID_PARAM'     // 参数非法（原生拒绝）
    | 'UNKNOWN';          // 兜底

class KernelError extends Error {
    constructor(message: string, readonly code: KernelErrorCode) { super(message); }
}
```

- 协议层只需维护 `KernelErrorCode → 协议错误码` 映射表（见 adapter design §5.3）。
- 发送超时预测（按文件大小估算）等逻辑收进 `apis/msg.ts`，协议层不关心。
- 只读接口用 `import type` 隔离，避免循环依赖。

## 6. 缓存（ADR-008）

- 独立 `cache/` 模块，kernel 持有唯一实例（单账号单进程）。
- **更新**：订阅原生事件主动维护（群列表事件 → 群缓存；成员事件 → 成员缓存）；查询缺失时惰性拉取 + 事件回填。
- **消费**：协议翻译层只读缓存，禁止调 API（翻译 = 纯函数，可并行、可测试、多协议共享）。
- 对外只暴露只读接口（`getMember(groupId, uid): Member | undefined`）。

### 6.1 canonical 消息元素模型（ADR-008 延伸，多协议翻译不重复的关键）

kernel 定义协议无关的规范消息元素模型，描述 QQ 消息的事实结构（从 `RawMessage.elements` 规范化而来）：

```ts
// types/message-element.ts
function toCanonicalElements(msg: RawMessage): CanonicalElement[];    // NT → 规范（只写一次）
function toSendElements(e: CanonicalElement[]): SendMessageElement[];  // 规范 → NT 发送（只写一次）
```

各协议（adapter 包内）只需写一层薄映射：

```
onebot11: canonical → CQ 码 / segment 数组（反向：解析 CQ 码 → canonical）
onebot12: canonical → segment（几乎同构，只差字段命名）
satori:   canonical → 元素（type/attrs，img/audio 等重命名）
```

放 kernel 的理由：描述的是 QQ 消息的事实；放 adapter 会导致 kernel 反向依赖 adapter，破坏边界。

## 7. 登录（ADR-010）

- `login.ts`：状态机（未登录/扫码中/已登录/掉线）+ `selfInfo` 维护 + 登录事件（协议层订阅做生命周期 meta 事件）。
- cli 只做二维码渲染 / URL 打印。
- 不做 framework 模式 → 无"等待 QQ 登录"场景，状态机只服务 QR 流程。

## 8. 日志与配置

- `logger.ts`：pino，支持 console + file + level，内置 redact（token/票据不打日志）。
- `config.ts`：ConfigBase（读 JSON → zod parse → 内存对象 → 变更写回）；napcat 主配置（fileLog/consoleLog/级别）在 kernel，**协议配置 schema 在各自协议包**（ADR-012）。

### 8.4 P1-1 wrapper 加载实现记录（2026-08-05，真实环境验证）

`wrapper-version.ts` + `wrapper-loader.ts` 已实现，通过 `pnpm check` + 真实环境冒烟测试（QQ 9.9.31-49919：版本探测 / listQQVersions / 加载 wrapper.node / 创建 session，vtable 0x7ffc... 模块地址）。**本轮探测的重大事实**：

- **wrapper.node 是 C++ ABI 模块，不是 N-API**：导出 33 个 MSVC mangled 符号（INTSessionShell / IGProSessionShell 构造与静态工厂 + opencv Mat 符号），`require`/`process.dlopen` 报 "Module did not self-register"，必须经 **koffi** 按 mangled 符号调用。
- **Node 进程内 SetDefaultDllDirectories 限制 DLL 搜索**（不含 PATH/cwd）：必须把 wrapper.node + 私有依赖（libvips-42 / libglib-2.0-0 / libgobject-2.0-0 / crypto / ssl / broadcast_ipc，在 resources/app）+ QQNT.dll/ffmpeg.dll（在 versions/<版本>/ 根）**复制到同一临时目录**再加载（LoadLibraryEx + ALTERED_SEARCH_PATH 从模块目录搜依赖）。
- **CreateNTSessionShell(std::string const&)** 返回 `shared_ptr<INTCSessionShellBase>`（mangled 名含 `__qq@std`：QQ 自定义 STL 命名空间）；std::string 为 MSVC x64 SSO 布局（16 字节 buffer + size + res，短串 <16 内联）。参数内容对创建无影响（试过 "test"/"probe"/空串均成功）。
- **session vtable 反射成功**（首 8 字节 = vtable 指针，槽位 0-11 非空，12 空）：槽位 2 返回 4（无效）；槽位 3-7 是**返回 std::string 的 getter**（槽位 3 返回 session 创建参数原样，槽位 4-7 返回其他 string/复用缓冲）——**不是 getService**（曾误判）。
- **getService 槽位未定位**：槽位 8+ 按 `(void* self, StdString* name)` 调用全部原生崩溃——这些方法签名不同（可能含 sret 隐藏返回指针 / 回调 / 复杂参数）。`shared_ptr` 是 non-trivial 类型（有析构）→ MSVC x64 用 **sret（RCX 返回缓冲指针，this 移到 RDX）**，但 sret 签名扫描槽位 8+ 仍崩。
- **QQ 9.9.31 JS 全量字节码化**（isByteCodeShell: true）：background.js / app_launcher / renderer 全是 V8 字节码，看不了 QQ 自身的 wrapper 调用代码（asar 明文路线堵死）。
- **探测脚本**：`scripts/probe/`（probe-session / probe-vtable / probe-find-service / probe-scan-modes 等，已验证加载 + 槽位扫描方法论），**加入 .gitignore 不提交**（研究工具，结论以本文档为准）；biome 嵌套 root 配置不受支持，gitignore 是唯一干净排除方式。
- **koffi 用法要点**：`koffi.decode(ptr, offset, type)` 参数顺序是 ptr(BigInt)/offset/type；`_Out_ SharedPtr*` 实现 sret；struct 指针参数用命名类型（`StdString *`）让 koffi 自动 marshalling JS 对象；struct 的 void* 字段 koffi 返回 BigInt。

**下一步（init 参数构造）**：见 §8.5 结论。

### 8.5 P1-2 RTTI 解析与 service 类名（2026-08-05）

**session 对象完整继承树（RTTI 解析，probe-rtti.mjs）**：`CreateNTSessionShell` 返回的 shared_ptr 指向 `nt::wrapper::NTWrapperSession`，但指针指向**对象偏移 24 的 INTSessionShell 子对象**（COL.offset=24），对象首地址 = ptr-24：

```
NTWrapperSession (0x0)
├── IQQNTWrapperSession (0x0)      vtable=0x395e068 (RVA)
│   ├── IWrapperSessionApi (0x8)   vtable=0x395e318
│   └── INTWrapperSessionApi (0x10) vtable=0x395e338
├── INTSessionShell (0x18)         vtable=0x395e368（shared_ptr 指向此处）
│   └── INTCSessionShell (0x18)
│       └── INTCSessionShellBase (0x18)
├── MSFSession::Delegate (0x70)
├── MSFSession::BusinessDelegate (0x78)
└── enable_shared_from_this (0x80)
```

**重要修正（推翻 §8.4 的 getService 认知）**：
- **没有 getService(name) 方法**（NapCat 公开源码 wrapper.ts 证实）：service 获取是**具名无参 getter**（getMsgService() / getGroupService() 等），每个 service 一个。
- **service 缓存在 session 对象内部偏移**（getMsgService 反汇编：读 this+0x490 → 非空则 jmp service->vtable[10]）；**CreateNTSessionShell 后 service 成员全为 null（dump 证实）→ 必须调用 init() 才创建 service**。
- **vtable 槽位 26-31 是转发 thunk**（读 this+offset → jmp service vtable），不是 getter 本身。
- 槽位 0-3/5/7 是相似函数族（同数据引用），槽位 6 是极小 stub——**NapCat TS 声明顺序 ≠ C++ vtable 顺序**。

**RTTI 类名大全（probe-rtti-names.mjs，wrapper.node 内 .?AV 字符串）**：
- **wrapper 层 service 实现类**（30+）：`KernelMsgService@wrapper@nt` / `KernelGroupService` / `KernelBuddyService` / `KernelAvatarService` / `KernelTicketService` / `KernelRichMediaService` / `KernelFileAssistantService` / `KernelProfileService` / `KernelFriendService` 等。
- **方法内 lambda 的 RTTI 直接暴露方法签名**：如 `setAllC2CAndGroupMsgRead@KernelMsgService@wrapper@nt@@UEAAXAEBV?$shared_ptr@VIOperateCallback@wrapper@nt@@@__qq@std@@@Z`（UEAA=虚方法，参数为 shared_ptr<IOperateCallback>）。**这是 service 方法签名的权威来源**。
- **NTWrapperSession 虚方法**（UEAA）：disableIpDirect(bool) / offLine(UnregisterInfo, shared_ptr) / OnConnected(MSFSession*) / OnDisconnected(MSFSession*, DisconnectReason) / StartRefreshLoginTicket(int)。
- **NTSessionBase 虚方法**（继承基类）：Init(2×std::function) / Close(function) / UpdateTicket(3×string) / SetOnNetworkChanged(NetStatus) / SetOnMsfStatusChanged / OffLineSync / SwitchToFront / OnUIConfigUpdate。
- **im_core 层实现**：`MsgService@im_core@nt` / `GroupService` / `BuddyService` 等（wrapper Kernel* 类包装它们）。

**下一步（init 参数构造，P1-3）**：service 必须 init 才存在。NapCat 的 session.init(config, depends, dispatcher, listener) 是 napi 4 参包装，C++ 侧可能是 NTSessionBase::Init 或独立方法（反汇编槽位 4 是**小方法**（读 this+0x490 → 调 service vtable[5]），不是 init——init 应是大函数）。候选：① 反汇编定位 init 槽位（大函数 + 大量写 this + 引用 SessionConfig@im_core 结构）；② 构造 SessionConfig 结构 + 3 个接口 mock（vtable 从 RTTI 类名推断）；③ NapCat 的 napi 桥接层（napi 包装的 init）可能接受 JSON 字符串形式。**结论归档，探测脚本在 scripts/probe/（gitignored）**。

### 8.6 P1-3 NAPI 引导装配（2026-08-05 定稿）

**路线**（用户拍板路线 A）：kernel 提供纯函数原语（createWrapper / initEngine / createSession / initSession / startSession，见 `wrapper-loader.ts`），`startNapuketto` 作为 boot 装配入口把链路串起来，被 `runtime/boot.cjs`（loader 包）调用。

**装配流程**：

```
boot.cjs（QQ 主进程，hook 截获 wrapper.node exports）
  → kernel.startNapuketto({ wrapperExports, env })
  → createWrapper(exports)：校验 NodeIQQNTWrapperEngine.get() → ctx
  → initEngine(ctx, config)：engine.initWithDeskTopConfig(config, GlobalAdapter)
  → createSession(ctx)：优先 startup.create() 回退 session.create()
  → initSession(ctx, config, listener)：session.init(config, DependsAdapter, DispatcherAdapter, listener)
  → startSession(ctx)：session.startNT(0)
```

**设计决策**：

- **versionInfo 从环境变量注入**：boot.cjs 运行在 QQ 主进程，无法访问 QQ 安装目录的 package.json 之外——launcher 在 spawn QQ 前通过 `NAPUTO_QQ_VERSION`（如 `9.9.31-49919`）传入，kernel 组装 `QQVersionContext`（fullVersion/buildVersion）。boot.cjs 不再硬编码版本路径。
- **sessionConfig 分阶段**：init 需要登录凭据（selfUin/a2/d2/d2Key），boot 阶段可能拿不到 → `startNapuketto` 允许缺省 sessionConfig：仅做 engine.init + createSession，init/start 留到 login 模块拿到 ticket 后再调（login 模块调用 `initSession/startSession` 原语）。若环境变量已提供凭据（`NAPUTO_QQ_UIN` 等），则一步到位。
- **listener 默认实现**：`startNapuketto` 提供日志版 `NodeIKernelSessionListener`（onNTSessionCreate / onSessionInitComplete / onUserOnlineResult 打日志），login 模块可覆盖。
- **engineConfig 默认值**：platform_type=KWINDOWS(3)、app_type=4、app_version=versionInfo.fullVersion、use_xlog=false，其余取环境变量或空值——首个真实联调确认字段。

**待实测（boot 链路）**：initWithDeskTopConfig 是否同步返回 / init 是否抛错（缺 ticket）/ startNT(0) 行为 / wrapper 是否要求 adapter 有具体方法（现在空对象）。

### 8.7 P1-4 QQ 进程内探测 + session 复用（2026-08-05 定稿）

**背景（实测推论）**：注入链路打通后，wrapper exports 是 QQ 已注册的单例（`NodeIQQNTWrapperEngine.get()` 返回 QQ 的 engine）。**QQ 自己已登录**——它的 session 已 init、service 已创建。因此**不应自己 create+init 新 session**（无凭据），而应**复用 QQ 的 session**：`NodeIQQNTWrapperSession.get()` 拿单例 → 直接 `getMsgService()` 等拿真实 service。

**探测目标（ADR-006 落地，QQ 进程内反射）**：
1. `session.get()` 返回什么？与 `create()` 的差异？
2. session 原型方法名全集（`Object.getOwnPropertyNames(Object.getPrototypeOf(session))`）
3. 各 `get*Service()` 返回值（null 还是对象？）及 service 原型方法名
4. 关键方法（登录/消息）返回形状 JSON dump

**探测结论（2026-08-05 实测，sessionId 格式确认）**：
- `NodeIQQNTWrapperSession.get()` **不存在**；静态方法只有 `getNTWrapperSession(sessionId)`。
- 正确链路：`NodeIQQNTStartupSessionWrapper.create()` → `start()` → `getSessionIdList()` 返回 **Map** `{nt: "nt_3", gpro: "gpro_3"}` → `getNTWrapperSession("nt_3")` 拿到主 session（已 init/已登录，60+ get*Service + 事件回调齐全）。
- **主 session 复用已打通**（probe-late 实测）：`getMainSession(ctx)` 固化进 wrapper-loader。

**⚠️ 重大修正（2026-08-05 深夜，参考 NapCatQQ shell 模式确认）**：
- **getNTWrapperSession(nt_x) 返回的是空 session**（未 init，核心 service 全 null）——那些是 startup.create() 创建的实例，不是 QQ 登录用的 session。
- **NapCat shell 模式（与我们注入方案最接近）的正确流程**（`src/shell/napcat.ts`）：
  1. `new wrapper.NodeIQQNTWrapperEngine()` + `engine.initWithDeskTopConfig(config, new wrapper.NodeIGlobalAdapter(...))`
  2. `new wrapper.NodeIKernelLoginService()` + `loginService.initConfig({appid, clientVer, commonPath, ...})`
  3. `loginService.addKernelLoginListener(new wrapper.NodeIKernelLoginListener(...))` → `getLoginList()` → `quickLoginWithUin(uin)`（或 QR 登录）
  4. **登录成功后**：`genSessionConfig(appid, version, uin, uid, dataPath)` 生成 `WrapperSessionInitConfig`（a2/d2 留空）
  5. `session.init(config, new wrapper.NodeIDependsAdapter(...), new wrapper.NodeIDispatcherAdapter(...), new wrapper.NodeIKernelSessionListener(listener))`
  6. `session.startNT(0)` → 等 `onSessionInitComplete === 0` → **Ready！**
- **adapters 必须用 `new wrapper.NodeIXxxAdapter({...})` 包装**（NAPI 构造器），不是裸对象。
- appid/qua：NapCat 从 `appid.json` 查表，9.9.31 兜底 `appid=537237765`、`qua=V1_WIN_NQ_<ver>_<build>_GW_B`。

**实现**：
- `kernel/src/lifecycle.ts`：完整启动编排（engine → loginService → 登录 → session.init → startNT）
- `kernel/src/probe.ts`：`probeRuntime(ctx)` —— 反射 dump session/service 方法到 `NAPUTO_CFG_DIR/napuketto-probe.json`（不引入日志依赖，直接 fs 写）。
- `wrapper-loader.ts` 增 `getMainSession(ctx)`：startup.create → start → getSessionIdList → getNTWrapperSession(nt_xxx)，失败回退 create。
- `boot.cjs` 探测模式：`NAPUTO_PROBE=1` 时 startNapuketto 后调 `kernel.probeRuntime`。

**产出**：探测结果 → 补全 `types/services/`（30+ NodeIKernel*Service）+ `types/wrapper.ts` session 方法 → 再实现 apis/、cache/、login。

### 8.8 装配层：core.ts + context.ts（2026-08-05 实现）

**CoreContext（context.ts，只读装配根）**：把 logger / paths / wrapper 上下文聚合成单一装配根，供协议层（adapter）与 apis/cache 消费。无全局单例（ADR-015 推论）：每进程一份，由装配层持有并传递。

```ts
interface CoreContext {
    logger: pino.Logger;
    paths: PathWrapper;
    wrapper: WrapperContext | null;   // startNapuketto 装配后填充
    login: LoginResult | null;        // 登录成功后填充
}
```

**NapukettoCore（core.ts）**：
- `NapukettoCore.create(opts)`：装配 paths（ensure 建目录）→ logger（console + 可选 file）→ CoreContext。
- `attachWrapper(wrapperExports, env)`：调 startNapuketto（createWrapper + engine.init + session），挂到 ctx.wrapper。
- `login(appid, opts)`：loginService.initConfig → quickLogin → buildSessionConfig → initAndStartSession，填 ctx.login。
- `stop()`：日志收尾（清理留给 P2 常驻管理）。

**用法**：boot.cjs 截获 exports 后即可 `NapukettoCore.create(...)` + `attachWrapper` + `login`，替代手工拼 startNapuketto/quickLogin/initAndStartSession；协议层从 ctx 拿 logger/paths/wrapper。

### 8.9 apis/msg（2026-08-05 实现，P2-1）

**msg service 类型依据**：`getMsgService()` 运行时反射 + NapCat 公开类型作说明书（接口签名是外部系统事实，自研描述，零复制）。核心方法面：

```ts
interface NodeIKernelMsgService {
    addKernelMsgListener(listener: NodeIKernelMsgListener): number;
    sendMsg(msgId: string, peer: Peer, elements: SendMessageElement[], map: Map<number, unknown>): Promise<GeneralCallResult>;
    recallMsg(peer: Peer, msgIds: string[]): Promise<GeneralCallResult>;
    getMsgs(peer: Peer, msgId: string, count: number, queryOrder: boolean): Promise<GeneralCallResult & { msgList: RawMessage[] }>;
    setMsgRead(peer: Peer): Promise<GeneralCallResult>;
    removeKernelMsgListener(listenerId: number): void;
}
```

**MsgApi（apis/msg.ts）**：内部解包 `{ result, errMsg }` → 成功纯业务值 / 失败抛 `KernelError`（ADR-009）。

```ts
class MsgApi {
    constructor(session: NodeIQQNTWrapperSession) {}
    sendMessage(target: Peer, elements: CanonicalElement[]): Promise<{ msgId: string }>;
    recallMessage(target: Peer, msgIds: string[]): Promise<void>;
    fetchMessages(target: Peer, opts: { count: number; msgId?: string }): Promise<RawMessage[]>;
    markRead(target: Peer): Promise<void>;
}
```

**错误映射**：result !== 0 → 按 errMsg 语义映射（`SEND_FAILED` / `NOT_FOUND` / `NOT_LOGIN` / `PERMISSION_DENIED` / 兜底 `UNKNOWN`），协议层只维护 KernelErrorCode → 协议错误码表。

**canonical → NT 发送元素**：`toSendElements` 实现 text（含 at）/ face / image / voice / reply 五类核心映射（ElementType 枚举 1/6/2/4/7），file/video/forward/json/xml 标记 TODO（P2-2 探测后补）。

### 8.10 消息事件链路（2026-08-05 实现，P2-2）

**MsgBridge（msg-bridge.ts）**：消息事件桥——注册原生 listener → 推入事件通道。

```ts
class MsgBridge {
    constructor(session: NodeIQQNTWrapperSession, channel: NTEventChannel<MsgListener, "Msg">);
    register(): void;    // addKernelMsgListener（普通 JS 对象）→ 回调 emit 到 channel
    unregister(): void;  // removeKernelMsgListener
}
```

- listener 为普通 JS 对象（NAPI 反射），`onRecvMsg` 等回调 emit 到 `NTEventChannel`（事件名 `Msg/onRecvMsg`）。
- 每个 Service 只注册一次原生监听；缓存维护与协议翻译都订阅 channel（ADR-003 设计）。

**toCanonicalElements（接收方向）**：RawMessage.elements → CanonicalElement[]，与 toSendElements 对称：

- TEXT(1)：textElement.content → text；atType 1/2/4 → at（all / atUid）
- PIC(2) → image（picPath）；FACE(6) → face（faceIndex）；PTT(4) → voice（filePath）
- REPLY(7) → reply（replayMsgId）；FILE(3) → file；VIDEO(5) → video
- 其余 → unknown（不抛错，接收方向宽容）

### 8.11 登录状态机（2026-08-05 实现，§9 第 7 项）

**login.ts：QrLoginSession**（QR 登录流程编排 + 状态机 + selfInfo）。

```
QrLoginSession.start():
  loginService.initConfig（已由 core.login 做）
  → addKernelLoginListener（普通 JS 对象，注册回调）
  → loginService.connect()
  → 有 -q 账号：quickLoginWithUin；无：getQRCodePicture() 触发二维码
  → 回调驱动状态机：未登录 → 扫码中（onQRCodeGetPicture）→ 已扫码（onQRCodeSessionUserScaned）
    → 已登录（onQRCodeLoginSucceed，填 selfInfo）
  → 二维码过期（onQRCodeSessionFailed errType=1 errCode=3）→ refresh() 重新 getQRCodePicture

QrLoginSession.refresh(): 手动/过期刷新二维码
QrLoginSession.onQrCode(cb): 订阅二维码图片（png base64 + url）
QrLoginSession.onStateChange(cb): 订阅状态变化
LoginState = "idle" | "waiting_scan" | "scanned" | "logged_in" | "failed"
```

**selfInfo**：登录成功后填 `{ uin, uid, nick }`；供 get_login_info 与协议层 meta 事件用。协议层订阅登录事件做生命周期 meta（P2-8 接入 adapter）。

### 8.1 路径布局（ADR-016）

数据（日志/配置/缓存）放**用户数据目录**而非程序目录（程序目录可能只读；多账号需要分离）：

```
<用户数据根>/<qq号>/          # 每账号独立目录（ADR-015 多账号前提）
├── config/                   # napcat.json + onebot11.json 等
├── logs/                     # pino 文件日志
└── cache/                    # 临时文件、媒体缓存
```

根路径优先级：cli `--data-dir`（显式参数）→ `NAPKETTO_DATA` 环境变量 → `~/.napuketto`（默认）。

### 8.2 QQ 版本探测（ADR-018）

`wrapper.node` 路径随 QQ 版本变化（`resources/app/wrapper.node` 或 `resources/app/versions/<版本>/wrapper.node`），加载前必须知道版本：

```ts
// wrapper-version.ts
interface QQVersionInfo {
    fullVersion: string;   // "9.9.15-28549"（探测产物）
    appid: string;         // 登录握手参数
    qua: string;
    wrapperPath: string;   // 解析出的 wrapper.node 绝对路径
}

function resolveQQVersion(installDir: string): QQVersionInfo;
function resolveWrapperPath(installDir: string, version: string): string;
```

版本信息从 QQ 安装目录哪个文件读、appid/qua 怎么拿到 → **P1 探测脚本第一批目标**。

### 8.12 P2-10 第一批 NapCat API 方法面（2026-08-05 设计 + 实现）

**目标**：HANDOVER.md §5.3 第一批（消息 + 群管类）所需 kernel 方法面。方法签名以 NapCat 公开类型作说明书自研描述（零复制）。**已实现并 pnpm check 全绿（103 文件）。**

**MsgService 补方法**（`types/services/msg-service.ts`）：
- `getMsgsByMsgId(peer, ids)` → `{ msgList }`（get_msg / 精华 / ptt 转文字共用）
- `setMsgEmojiLikes(peer, msgSeq, emojiId, emojiType, setOrCancel)`（set_msg_emoji_like）
- `translatePtt2Text(msgId, peer, msgElement)`（fetch_ptt_text：异步转写，文本写回 pttElement.text；PttElement 补 `text?` 字段）

**GroupService 补方法**（`types/services/group-service.ts`）：
- `kickMemberV2(KickMemberV2Req)`（set_group_kick；**kickFlag/kickList 字段值待探测校准**：optFlag=1 普通踢 / 0 拉黑，TODO P3 联调）
- `setMemberShutUp(groupCode, memberTimes[])`（set_group_ban，timeStamp=0 解禁）
- `setGroupShutUp(groupCode, bool)`（whole_ban）/ `modifyMemberRole`（admin，void 语义乐观处理）
- `modifyMemberCardName`（card，void）/ `modifyGroupName(groupCode, name, isNormalMember)`（name）
- `quitGroupV2({groupCode, needDeleteLocalMsg})`（leave，is_dismiss）
- `addGroupEssence` / `removeGroupEssence({groupCode, msgRandom, msgSeq})`（精华；返回形状未知，GroupApi 宽松校验 result 数字非 0）
- `getGroupRemainAtTimes(groupCode)` → `{ atInfo }`（at_all_remain）
- 新增 `KickMemberInfo` / `KickMemberV2Req` / `GroupRemainAtTimes` 类型

**MsgApi 补**：`fetchMsgsByMsgId`（get_msg / 精华 / ptt 共用）/ `setMsgEmojiLike(peer, opts)`（options 对象规避 useMaxParams）/ `fetchPttText(msgId, peer)`（内部：getMsgsByMsgId → 找 PTT 元素 → translatePtt2Text → 再取回读 pttElement.text；数组解构规避 noUncheckedIndexedAccess + useDestructuring 双规则）。

**GroupApi 补**：kickMember / setMemberShutUp / setGroupShutUp / setMemberRole（同步 void）/ setMemberCardName（同步 void）/ modifyGroupName / quitGroup / addGroupEssence(groupCode, msgId)（**构造时同时取 msgService**，内部经 getMsgsByMsgId 取 msgSeq/msgRandom）/ removeGroupEssence / getGroupRemainAtTimes。

**⚠️ set_group_special_title 不实现**：NapCat 走 OIDB 自定义包（`OidbSvcTrpcTcp0X8FC_2` + sendOidbPacket）——违反 NAPI 路线（禁绕过 NAPI 的自定义包/裸调），列入待办（等 `sendSsoCmdReqByContend` 可行性评估）。

### 8.13 P2-11 第二批 NapCat API 方法面（2026-08-05 设计 + 实现）

**目标**：HANDOVER.md §5.3 第二批（好友类 + 系统类 + 消息类剩余）。方法签名以 NapCat 公开类型作说明书自研描述（零复制）。**已实现并 pnpm check 全绿（117 文件）。**

**BuddyService 补方法**（`types/services/buddy-service.ts`）：
- `getBuddyReq()` → `{ buddyReqs?: BuddyReq[] }`（好友申请列表；`BuddyReq` 新类型：reqTime/friendUid/friendNick/sourceId/... 待探测校准）
- `approvalFriendRequest({ friendUid, reqTime, accept })`（set_friend_add_request 应答）
- `setBuddyRemark({ uid, remark })`（set_friend_remark，void 语义乐观处理）
- `delBuddy({ friendUid, tempBlock, tempBothDel })`（delete_friend）
- `getDoubtBuddyReq(reqId, num, uk)`（get_doubt_friends_add_request；reqId=Date.now() 作回执匹配，返回 doubtList）
- `approvalDoubtBuddyReq(uid, str1, str2)`（set_doubt_friends_add_request，void）

**MsgService 补方法**：`sendShowInputStatusReq(chatType, eventType, toUid)`（set_input_status）。

**FriendApi 补**：getBuddyReqList / handleFriendRequest(notify, accept) / setFriendRemark / deleteFriend / getFriendCategories（分类保留，get_friends_with_category 用）/ getDoubtFriendRequest(count)（doubtList → OB11 结构，uin 经注入的 uidToUin 转换，缺省回退 uid）/ handleDoubtFriendRequest(uid)。

**MsgApi 补**：`setInputStatus(target: Peer, eventType)` → sendShowInputStatusReq。

**PathWrapper 补**：`clearCache()`（清空 cacheDir 下文件保留目录，clean_cache 动作经注入回调消费）。

**跳过**（依赖未探测 service ★）：send_like / set_online_status / set_diy_online_status（UserApi.setSelfOnlineStatus——实际是 setStatus 属 MsgService 但 NapCat 走 UserApi 包装，待探测）；get_cookies / get_clientkey / get_rkey（TicketService 从 QQ 本地数据读取，非 service 调用）；get_stranger_info / set_qq_profile（ProfileService）；get_online_clients（getOnLineDev 返回 void，需探测）。

### 8.14 P2-12 第三批 NapCat API 方法面（2026-08-05 设计 + 实现）

**目标**：HANDOVER.md §5.3 第三批（合并转发 + 在线状态 + 单条转发 + download_file + 进程控制）。**全部基于已探测的 MsgService 方法面，无需新探测。已实现并 pnpm check 全绿（124 文件）。**

**MsgService 补方法**（`types/services/msg-service.ts`）：
- `buildMultiForwardMsg({ srcMsgIds, srcContact })` → `{ rspInfo: { elements } }`（合并转发组装，返回 MULTI_FORWARD 元素）
- `getMultiMsg(peer, msgId, resId)` → `{ msgList }`（get_forward_msg 取合并内容；resId 取自 multiForwardMsgElement）
- `forwardMsg(msgIds, peer, dstPeers, commentElements)`（单条转发）
- `setStatus({ status, extStatus, batteryStatus, customStatus? })`（set_online_status / set_diy_online_status）

**entities 补**：`RawElement` 加 `multiForwardMsgElement?: { resId; fileName; xmlContent }`。

**MsgApi 补**：
- `sendForwardMessage(target, sourcePeer, srcMsgIds)`：buildMultiForwardMsg → rspInfo.elements 直接作 sendMsg 元素 → `{ msgId }`（元素本身已是 MULTI_FORWARD，无需 toSendElements）
- `fetchForwardMessage(peer, msgId)`：fetchMsgsByMsgId → 找 multiForwardMsgElement → getMultiMsg(peer, msgId, resId) → RawMessage[]；找不到 resId 抛 NOT_FOUND
- `forwardSingleMessage(srcPeer, srcMsgIds, dstPeer)`：forwardMsg(srcMsgIds, srcPeer, [dstPeer], undefined)
- `setOnlineStatus(opts)`：setStatus（customStatus 可选）

**跳过**（依赖未探测 service ★）：send_like（UserApi.like）/ get_cookies / get_clientkey / get_rkey（TicketService）/ get_online_clients（getOnLineDev 返回 void）/ ocr_image / get_image / get_record（RichMediaService）/ 文件类（FileService）。

### 8.3 P0-1 实现记录（2026-08-04）

`errors.ts` / `paths.ts` / `logger.ts` / `config.ts` 已实现，通过 `pnpm check` + 运行时冒烟测试（26 项）。关键决策：

- **ConfigBase 零 zod 依赖**：kernel 不引入 zod（ADR-012），只定义校验器最小接口 `ConfigSchema<T> = { parse: (input: unknown) => T }`；协议包的 zod schema 天然满足，kernel 主配置用手写校验器包装。
- **文件日志用同步写入**（`pino.destination({ dest, sync: true })`）：实验发现异步 SonicBoom 的 `flushSync()` 在 fd 未 ready 时抛 "sonic boom is not ready yet"，且 `pino.multistream` 的 `flush()` 不转发回调（`await logger.flush()` 挂起）——退出前可靠刷盘成本高；同步写在日志量级下性能可接受且进程退出不丢日志。
- **pino 类型为 `export = pino` namespace 风格**：named type import（`import type { Logger } from 'pino'`）不可用（biome `noUnresolvedImports` 不识别 export= 成员），一律用 `pino.Logger` / `pino.DestinationStream` / `pino.LoggerOptions` namespace 访问。
- **INVALID_PARAM 承担基础设施错误**：配置 JSON 解析/校验失败、logger 无输出目标均抛 `KernelError('INVALID_PARAM')`；P1 探测真实错误返回后再扩充错误码。
- **主配置推迟**：kernel 主配置（fileLog/consoleLog/级别）类型与 schema 留到 P1 与 core 装配一起定。
- **biome.json 例外清单**（与 `noNodejsModules: off` 同理的 Node/NodeNext 误报关闭）：`useImportExtensions`（NodeNext 要求相对导入 `.js`）、`useLiteralKeys`（tsc `noPropertyAccessFromIndexSignature` 要求 `[]` 访问）、`noProcessEnv`（ADR-016 设计使用环境变量）、`noBarrelFile`（包入口聚合）、`useErrorCause`（自定义 KernelError 已传 cause，biome 静态分析不了构造第三参数）、`noSecrets`（中文错误消息被误判高熵密钥）。

## 9. 实现顺序（P0 → P1）

1. ✅ `paths.ts` + `logger.ts` + `config.ts` + `errors.ts`（无原生依赖，先行，2026-08-04 完成）
2. ✅ `scripts/probe/` 探测脚本 → 产出 `types/`（含 wrapper-version 探测）——占位类型已建（types/listeners + types/entities），探测产出后替换
3. ✅ `event-channel.ts`（2026-08-04，用占位 Listener 类型验证机制；真实签名待探测后对齐）
4. ✅ `wrapper-loader.ts` + `wrapper-version.ts`（2026-08-05，koffi + DLL 复制方案，真实环境验证 session 创建）
5. ✅ 类型层：runtime 探测 + NapCat shell 模式参考确认（wrapper 类型 + service 契约，见 §8.5/§8.7；getService vtable 逆向**不再需要**——NAPI 范式下全部走普通 JS 对象调用）
6. ✅ `core.ts` + `context.ts` 装配（2026-08-05，见 §8.8）
7. ✅ `login.ts`（QR 状态机 + selfInfo + core.login QR 回退，2026-08-05，见 §8.11）
8. ⏳ `apis/`（**msg 完成**（sendMessage/recallMessage/fetchMessages/markRead，2026-08-05，见 §8.9）；group/friend/user/file/system 待做）
9. `cache/`（随 apis 一起演进）

**事件链路（P2-2，2026-08-05 完成）**：MsgBridge（原生 listener → NTEventChannel）+ toCanonicalElements（接收方向映射）——消息「收到 → 广播」半链路打通，adapter 侧订阅即用。

## 10. 待验证事项

- `loginService` 是独立 `new` 还是从 session 获取（取决于运行时探测结果）。
- `CoreContext` 是否沿用 NapCat 的 `InstanceContext` 模式（只读装配根），去掉 workingEnv/loginService 字段。
- 原生回调在 Shell 模式下是否走异步队列（影响 event-channel 是否需要缓冲）。
