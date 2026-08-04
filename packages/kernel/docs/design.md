# @napuketto/kernel 设计

> 职责：**唯一原生交互层 + 唯一共享状态层**。协议层只认识 kernel，不认识 QQ。
> 对应 ADR：001 / 003 / 006 / 007 / 008 / 009 / 010 / 012 / 016 / 017 / 018
> 状态：P0-1 已完成（errors / paths / logger / config，2026-08-04，见 §8.3）；P0-2 已完成（event-channel + 占位 Listener 类型，2026-08-04，见 §4.1）；P1-1 已完成（wrapper-version + wrapper-loader，真实环境验证，2026-08-05，见 §8.4）；P1-2 探测完成（RTTI 继承树 + service 类名/方法签名大全，2026-08-05，见 §8.5）；下一步构造 session.init() 参数（见 §8.5 结论）。

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
5. ⏳ getService / service vtable 逆向（见 §8.4 下一步）→ 产出 `types/wrapper.ts` + `types/services/`
6. `core.ts` + `context.ts` 装配（P1 与登录打通）
7. `login.ts`
8. `apis/`（先 msg，后 group/friend/user/file/system）
9. `cache/`（随 apis 一起演进）

## 10. 待验证事项

- `loginService` 是独立 `new` 还是从 session 获取（取决于运行时探测结果）。
- `CoreContext` 是否沿用 NapCat 的 `InstanceContext` 模式（只读装配根），去掉 workingEnv/loginService 字段。
- 原生回调在 Shell 模式下是否走异步队列（影响 event-channel 是否需要缓冲）。
