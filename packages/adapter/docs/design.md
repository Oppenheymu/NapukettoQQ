# @napuketto/adapter 设计

> 职责：**协议适配器容器**——一个共享的适配器框架（core），外加 OneBot 11 / OneBot 12 / Satori 三套协议语义。
> 对应 ADR：002 / 003 / 008 / 009 / 013 / 014 / 017
> 状态：core 框架已实现（BaseAction / ActionRegistry / AdapterRegistry / ProtocolConfig / BaseProtocolAdapter，2026-08-04，见 §8）；onebot11 第一梯队已实现（types / helper/config / action/send_msg，2026-08-04，见 §8.1）；onebot11 helper 翻译层已实现（cqcode/data，2026-08-04，见 §8.2）；onebot11 事件模型已实现（message/notice/request/meta，2026-08-05，见 §8.3）；onebot11 动作骨架扩充已实现（error-map + 6 个查询动作 + types 补全，2026-08-05，见 §8.4）；**onebot11 adapter.ts 已实现（2026-08-05，见 §8.5）——订阅 kernel 消息事件 → OB11 消息事件 → network 广播（消息收链路打通）**；**P2-3 请求分发 + send_msg 真实化 + MessageUnique（2026-08-05，见 §8.6）——收发闭环打通**；**P2-4 查询动作真实化（2026-08-05，见 §8.7）——apis/group + apis/friend + 6 查询动作接 kernel**；**P2-5 传输接入（2026-08-05，见 §8.8）——HTTP/WS server+client + 鉴权 + 心跳 meta 事件**；**P2-6 cli 启动编排（2026-08-05，见 §8.9）——boot.cjs 补协议装配 + cli 参数解析拉起 QQ**。**§9 实现顺序 5-6 已同步更新。**

---

## 1. 边界

- **做**：协议适配器框架（生命周期骨架、zod 校验、请求分发、配置热更新）+ 各协议的语义实现。
- **不做**：直接访问 wrapper/session（禁止）；传输实现（交给 network）；媒体转码（交给 media）。

依赖：`@napuketto/kernel`、`@napuketto/network`、`@napuketto/media`；另有 `zod`（校验）、`fast-xml-parser`（XML 解析，用于富文本）。

## 2. 为什么是"容器"而不是"三个平级包"（ADR-013）

OneBot 11 / OneBot 12 / Satori 三者共享的是**适配器骨架**：订阅 kernel 事件通道 → 翻译 → 交给 network 广播；接收 network 请求 → 校验 → 分发 → 响应；配置热更新；心跳；生命周期。这部分与协议无关，只写一次。

三个协议真正不同的只有四样：
1. **配置 schema**（各写各的）
2. **事件映射**（kernel 事件 → 协议事件）
3. **动作实现**（协议动作 → kernel 调用）
4. **消息元素映射**（canonical 元素 → 协议格式 / 反向）

## 3. 目录结构

```
packages/adapter/src/
├── core/                          # 协议适配器框架（只写一次）
│   ├── BaseProtocolAdapter.ts     # 生命周期骨架：订阅 kernel → 翻译 → network 广播；请求分发
│   ├── BaseAction.ts              # zod 校验 + handle / websocketHandle / echo
│   ├── registry.ts                # 适配器注册表（cli 按 enabledProtocols 装配）
│   └── config.ts                  # 协议配置加载基类（zod + JSON 读写）
├── onebot11/                      # 当前主战场
│   ├── adapter.ts                 # OB11ProtocolAdapter extends BaseProtocolAdapter
│   ├── action/                    # msg/ group/ user/ system/ file/ go-cqhttp/ extends/
│   ├── event/                     # OB11BaseEvent + message/ notice/ request/ meta/
│   ├── helper/                    # config.ts + data.ts（OB11Constructor）+ cqcode.ts
│   ├── api/                       # OneBotGroupApi / UserApi / FriendApi（聚合 + 缓存）
│   └── types/                     # OB11 类型 + OB11Return
├── onebot12/                      # P5（规划）：adapter.ts + action/event/helper/types
└── satori/                        # P6（规划）：adapter.ts + action/event/helper/types
```

## 4. 子路径导出（ADR-014）

包采用子路径导出而非单入口，让 cli 只依赖用到的协议，`./core` 也可被第三方复用：

```json
// package.json exports（与 tsdown 多入口对应）
{
    "exports": {
        ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
        "./core": { "types": "./dist/core/index.d.ts", "import": "./dist/core/index.js" },
        "./onebot11": { "types": "./dist/onebot11/index.d.ts", "import": "./dist/onebot11/index.js" },
        "./onebot12": { "types": "./dist/onebot12/index.d.ts", "import": "./dist/onebot12/index.js" },
        "./satori": { "types": "./dist/satori/index.d.ts", "import": "./dist/satori/index.js" }
    }
}
```

- tsdown 配多入口（每个子路径一个 entry），产物 `dist/onebot11/index.js` 与 exports 一一对应。
- 每个协议目录的 `index.ts` 即其公共面（导出什么用户用什么），天然约束各协议 API。
- **根入口 `index.ts` 保持轻量**：只导出公共类型（如 `ProtocolId`），不聚合三个协议。

## 5. 核心接口（草案）

```ts
// core/BaseProtocolAdapter.ts —— 骨架，三个协议各自实现很薄
abstract class BaseProtocolAdapter {
    abstract readonly protocol: 'onebot11' | 'onebot12' | 'satori';
    abstract readonly configSchema: ZodType;                 // 协议配置
    abstract readonly actions: ActionRegistry;               // 请求 → 动作
    abstract translateEvent(e: KernelEvent): ProtocolEvent;  // kernel 事件 → 协议事件（薄映射）
    abstract translateRequest(req: ProtocolRequest): KernelCall;  // 协议请求 → kernel 调用

    start(): Promise<void>;   // 订阅 kernel 事件通道 + 注册 network 传输（骨架统一实现）
    stop(): Promise<void>;
    reload(config: unknown): Promise<void>;  // 配置热更新（骨架统一实现）
}
```

## 5. 关键设计

### 5.1 规范消息元素模型（放 kernel，不在 adapter）

三个协议翻译不重复的关键：**kernel 定义协议无关的 canonical 消息元素模型**（ADR-008 延伸）：

```ts
// kernel/entities/message-element.ts —— 描述 QQ 消息的事实，与协议无关
type CanonicalElement =
    | { type: 'text'; text: string }
    | { type: 'at'; target: string; display?: string }
    | { type: 'image'; path: string; url?: string; size?: { width: number; height: number } }
    | { type: 'face'; id: string }
    | { type: 'voice'; path: string; durationMs?: number }
    | { type: 'video'; path: string }
    | { type: 'file'; path: string; name?: string; size?: number }
    | { type: 'reply'; messageId: string }
    | { type: 'forward'; messageIds: string[] }
    | { type: 'json' | 'xml' | 'unknown'; raw: unknown };

function toCanonicalElements(msg: RawMessage): CanonicalElement[];    // NT → 规范（只写一次）
function toSendElements(e: CanonicalElement[]): SendMessageElement[];  // 规范 → NT 发送（只写一次）
```

然后各协议只写**薄映射**：
```
onebot11: canonical → CQ 码 / segment 数组（反向：解析 CQ 码 → canonical）
onebot12: canonical → segment（几乎同构，只差字段命名）
satori:   canonical → 元素（type/attrs，img/audio 等重命名）
```

**为什么 canonical 放 kernel**：它描述的是"QQ 消息长什么样"这个事实（RawMessage 是 QQ 的事实结构），与协议无关；放 adapter 会导致 kernel 反向依赖 adapter，破坏"kernel 是唯一原生交互层"。

### 5.2 数据翻译（ADR-008）

协议翻译时**只读 kernel 缓存**（成员 card、昵称等），禁止实时调 API——纯函数、可并行、可测试。对比 NapCat 每条消息实时查成员列表的竞态问题。

### 5.3 错误映射表（ADR-017）

kernel 抛 `KernelError`（带错误码），协议层只维护映射表而非解析逻辑：

```ts
// core/error-map.ts（各协议各自实现）
const OB11ErrorMap: Record<KernelErrorCode, number> = {
    SEND_FAILED: 100,
    PERMISSION_DENIED: 101,
    NOT_FOUND: 102,
    TIMEOUT: 103,
    NOT_LOGIN: 104,
    INVALID_PARAM: 105,
    UNKNOWN: 999,
};

// BaseAction 内统一：catch (e) → e instanceof KernelError ? OB11ErrorMap[e.code] : OB11ErrorMap.UNKNOWN
```

各协议（OB11/OB12/Satori）各写一份映射表，但共享同一套 `KernelErrorCode`。

### 5.4 生命周期

- 订阅 kernel 登录事件 → 发协议 meta 生命周期/心跳事件。
- 配置热更新：监听配置变更 → 与 network 协商重建/差量更新适配器。

## 6. 实现顺序（P2 → P6）

1. `core/`（BaseProtocolAdapter + BaseAction + registry + config）+ package.json 子路径导出（ADR-014）
2. `onebot11/types/` + `helper/config.ts`（zod schema）
3. `onebot11/helper/cqcode.ts` + `data.ts`（翻译）
4. `onebot11/api/`（聚合 + 缓存）
5. `onebot11/adapter.ts`：订阅 kernel 事件 → OB11 事件 → network 广播
6. `onebot11/action/` 按痛点排序：`send_msg` 系列 → `get_*` 系列 → 群管 → 文件 → go-cqhttp 扩展
7. `onebot12/`（P5）→ `satori/`（P6）：复用 core，各写薄映射

## 7. 待验证事项

- OB11 消息段（CQ 码）与 NT 元素（ElementType）的完整映射表（P2 先覆盖 text/at/image/face，P4 补全）。
- canonical 元素模型的具体字段集合（以运行时探测的 RawMessage 为准）。
- 多协议共存在同一进程的适配器隔离（各协议独立配置、独立启停）。

## 8. 实现记录（2026-08-04，core 框架）

- **BaseAction**：`handle`（HTTP）/`websocketHandle`（WS）统一 zod 校验 + KernelError→协议错误码映射（errorCodeMap 由各协议提供，ADR-017）；校验失败 retcode 400/1400。
- **BaseProtocolAdapter**：生命周期骨架（start→加载配置→onStart 钩子；stop→onStop；reload→onReload），`broadcastEvent` 经 EventBroadcaster 广播；协议层实现 `ProtocolHooks` 注入。
- **ProtocolConfig**：复用 kernel `ConfigBase`（zod schema 天然满足其校验器接口，ADR-012）。
- **ActionRegistry / AdapterRegistry** 拆分单类文件（noExcessiveClassesPerFile）。
- **子路径导出落地**（ADR-014）：package.json `exports` 配 `./core`，tsdown `entry: ["src/index.ts", "src/core/index.ts"]`。
- **⚠️ workspace 引用修复（重要）**：tsdown 实际产物是 `.mjs`/`.d.mts`，但 kernel/network/media 的 package.json `main/types/exports` 指向 `.js`/`.d.ts`（不存在）→ 所有包已改为 `.mjs`/`.d.mts`，否则 `@napuketto/kernel` 等 workspace 引用解析失败（TS2307）。biome `noUnresolvedImports` 对 workspace 包误报，已关。

### 8.1 onebot11 第一梯队（2026-08-04）

`types/`（OB11 类型 + OB11Return）+ `helper/config.ts`（ob11ConfigSchema zod schema，http/httpPost/ws/wsReverse/token）+ `action/send-msg.ts`（SendMsgAction，骨架）+ `action/index.ts`（createOb11ActionRegistry）。通过 `pnpm check` + 11 项运行时冒烟测试。关键点：

- **子路径导出 `./onebot11` 落地**（ADR-014）：tsdown 多入口 + exports。
- **OB11 字段为 snake_case**（`user_id`/`group_id` 等协议规范不可改）→ biome `useNamingConvention` 配置 `conventions`：`typeParameter` PascalCase、`typeMember` camelCase+snake_case、`objectLiteralMember` camelCase+snake_case+CONSTANT_CASE（错误码映射键）。
- **zod v4 `.default({})` 需完整 shape**：`z.object({...}).default({})` 报 TS2769，需显式给全默认值。
- **SendMsgAction 为骨架**：`_handle` 返回占位 message_id（`Date.now()`），P2 打通 kernel apis/msg 后替换；`ob11ErrorCodeMap`（ADR-017）导出供协议层复用。
│   ├── BaseAction.ts         # 抽象基类：zod 校验 + 统一 handle / websocketHandle + 错误捕获
│   ├── msg/ group/ user/ system/ file/     # 标准 OB11 动作
│   ├── go-cqhttp/            # go-cqhttp 兼容扩展（合并转发、群公告、消息历史...）
│   └── extends/              # NapCat 风格独有扩展（OCR、翻译、在线状态...）
├── event/                    # OB11 事件模型
│   ├── OB11BaseEvent.ts      # 基类（time/self_id/post_type）
│   ├── message/ notice/ request/ meta/
├── helper/
│   ├── config.ts             # OB11 配置（zod schema，归属本包：ADR-012）
│   ├── data.ts               # OB11Constructor：NT 实体 → OB11 格式 / CQ 码（只读缓存）
│   └── cqcode.ts             # CQ 码编解码
├── api/                      # OneBotGroupApi / UserApi / FriendApi（聚合 kernel API + 读缓存）
└── types/                    # OB11 类型 + OB11Return
```

## 3. 关键设计

### 3.1 BaseAction（zod 替代 ajv）

```ts
abstract class BaseAction<TPayload, TReturn> {
    abstract name: string;                    // 动作名（注册表 key）
    abstract schema: ZodType<TPayload>;       // 参数校验（zod）
    protected abstract _handle(payload: TPayload): Promise<TReturn>;

    handle(payload: unknown): Promise<OB11Return<TReturn | null>>;    // HTTP 入口
    websocketHandle(payload: unknown, echo: unknown): Promise<...>;   // WS 入口（echo 透传）
}
```

- zod 校验失败 → `retcode 400`（HTTP）/ `1400`（WS）。
- 错误语义统一来自 kernel apis 的类型化错误（ADR-009），映射到 OB11 错误码。

### 3.2 数据翻译（ADR-008）

`OB11Constructor` 翻译消息时**只读 kernel 缓存**（成员 card、昵称等），禁止实时调 API——纯函数、可并行、可测试。对比 NapCat 每条消息实时查成员列表的竞态问题。

### 3.3 ID 映射

`MessageUnique`：OneBot `message_id` ↔ NT `msgId/msgSeq` 双向映射，放本包（协议相关）。

### 3.4 生命周期

- 订阅 kernel 登录事件 → 发 OB11 meta 生命周期/心跳事件。
- 配置热更新：监听配置变更 → 与 network 协商重建/差量更新适配器（参考 NapCat 的 `reloadNetwork` 思路，实现自研）。

## 4. 实现顺序（P2 → P4）

1. `types/` + `helper/config.ts`（zod schema）
2. `BaseAction.ts` + `action/index.ts`（注册表 `createActionMap`）
3. `helper/cqcode.ts` + `helper/data.ts`（翻译）
4. `api/`（聚合 + 缓存）
5. `adapter.ts`：订阅 kernel 事件 → OB11 事件 → network 广播
6. 动作按痛点排序：`send_msg` 系列 → `get_*` 系列 → 群管 → 文件 → go-cqhttp 扩展

## 5. 待验证事项

- OB11 消息段（CQ 码）与 NT 元素（ElementType）的完整映射表（P2 先覆盖 text/at/image/face，P4 补全）。
- 多协议共存时 onebot 包与未来 onebot12/satori 包的公共抽象（是否抽共享协议基座包，P5 前再定）。

### 8.2 onebot11 helper 翻译层（2026-08-04）

`helper/cqcode.ts` + `helper/data.ts` 已实现，通过 `pnpm check` + 21 项运行时冒烟测试（转义往返/全类型映射/未知类型保留/端到端）。关键决策：

- **cqcode.ts 保持类型无关**：只做「文本 ↔ CQ 码片段」通用编解码（escapeCqText / escapeCqParam / unescapeCqText / encodeCqCode / parseCqMessage / serializeCqParts），不 import OB11 类型；segment 级映射在 data.ts。
- **转义顺序**：编码时 & 最先转（避免 `&#91;` 里的 & 被二次转义）；解码时 &amp; 最后解（避免 `&amp;#44;` 误伤）。
- **canonical 模型落地**（ADR-008 延伸）：kernel 新增 `types/message-element.ts`（`CanonicalElement` 联合 + `toCanonicalElements`/`toSendElements` 占位骨架，P1 探测后填实现），adapter 只写 canonical ↔ OB11 薄映射。
- **canonical 微调**：voice/video 增加 `url?` 字段（OB11 record/video 段有 url，往返不丢数据）；file/unknown 元素 OB11 无法表达 → 翻译时跳过。
- **未知 CQ 类型**：保留原文为 text 段（go-cqhttp 兼容行为，消息往返不丢数据）；缺失参数用空串兜底。
- **CQ → segment 用查找表**（`CQ_SEGMENT_BUILDERS`）而非 if/else 链：11 分支 if 链认知复杂度 20 > 15，查找表降为 3。
- **biome 约束（preset all）**：noTernary / useExportsLast / noMagicNumbers 激活——可选字段构造用 if 赋值 helper（mediaData / atData / canonicalMedia / canonicalAt），导出统一置后，端口等魔数提常量。
- **canonicalMedia 断言**：`{ type, path } as MediaCanonical`（窄联合），避免 as CanonicalElement 破坏 CFA 收窄导致 `el.url` 报 TS2339。

### 8.3 onebot11 事件模型（2026-08-05）

`event/`（base + message + notice + request + meta）已实现，通过 `pnpm check` + tsc 类型断言（判别收窄验证）。关键决策：

- **四类可判别联合**：`OB11Event = OB11MessageEvent | OB11NoticeEvent | OB11RequestEvent | OB11MetaEvent`，统一 `OB11BaseEvent`（time/self_id/post_type），二级判别 message_type / notice_type / request_type / meta_event_type 收窄。
- **消息事件细分**：群聊 `OB11GroupMessageEvent`（sub_type normal/anonymous/notice，sender 含必填 role + title）+ 私聊 `OB11PrivateMessageEvent`（sub_type friend/group/other/self，temp_source 临时会话来源）；原 `types/` 的粗粒度 `OB11MessageEvent` 迁移至此。
- **通知事件**：8 类 OB11 标准（group_upload/admin/decrease/increase/ban/friend_add/group_recall/friend_recall）+ go-cqhttp 扩展（group_card/group_essence/notify/offline_file）+ NapCat 兼容扩展（group_sign/msg_emoji_like/group_title），每类独立 interface + 联合。
- **请求事件**：friend（comment/flag）/ group（sub_type add/invite），flag 透传给 set_*_request 动作应答。
- **元事件**：lifecycle（enable/disable/connect）+ heartbeat（interval + status），status 与 get_status 同构（online/good + 扩展透传）。
- **biome 约束**：`export type ... from` 重导出不进入模块作用域（OB11Event 联合引用不到名字）→ 联合类型用别名 import（`as MessageEventUnion`）；同名 import + re-export 会触发 noExportedImports / noUnusedImports 冲突，别名方案两全。
- **类型断言验证**：临时 ts 文件用 tsc 验证 post_type → 二级字段 → 字段访问的逐层收窄（group_ban.duration / notify.sub_type / group_upload.file.size / heartbeat.interval 等），验证后删除。

### 8.4 onebot11 动作骨架扩充（2026-08-05）

`ob11ErrorCodeMap` 抽离 + 6 个查询类动作骨架 + types 补全，通过 `pnpm check` + 7 项运行时冒烟测试（注册表完整/校验 400/1400/骨架 reject 映射 999）。关键决策：

- **errorCodeMap 抽到 `action/error-map.ts`**：原定义在 send-msg.ts 内，动作多了必须共享；send-msg.ts 改为导入，onebot11 入口导出源同步更新。
- **6 个查询类动作骨架**：get_login_info / get_group_info / get_group_list / get_group_member_info / get_group_member_list / get_friend_list——zod schema（含 go-cqhttp no_cache 扩展）+ `_handle` 占位 reject（映射 UNKNOWN=999）+ TODO(P1/P2) 注释；kernel apis 打通后逐个填实现，无需改注册表。
- **types 补全动作返回值**：GroupMemberInfo（含 go-cqhttp 扩展：qq_level/special_title/shut_up_timestamp/is_friend 等）/ FriendInfo / StrangerInfo / GroupHonorInfo（current_talkative + 5 列表）/ VersionInfo（protocol_version 固定 "v11" + go-cqhttp 扩展）/ Sex 枚举。
- **骨架 reject 而非占位返回值**：查询类动作在 kernel 未接入时返回假数据会误导调用方，reject（→ 999）语义更诚实；send_msg 保留占位 message_id（Date.now）是历史约定，P2 一并替换。

### 8.5 onebot11 adapter（2026-08-05，消息收链路打通）

`NapukettoOneBot11Adapter`（onebot11/adapter.ts）：订阅 kernel 消息事件通道 → 翻译 OB11 消息事件 → network 广播。

```ts
class NapukettoOneBot11Adapter extends BaseProtocolAdapter<OB11Config> {
    constructor(opts: {
        config: ProtocolConfig<OB11Config>;
        broadcaster: EventBroadcaster;
        msgChannel: MsgEventChannel;   // kernel 消息事件通道（MsgBridge 持有）
        selfUin: string;               // 机器人 QQ 号（self_id）
    });
}
```

**翻译（RawMessage → OB11MessageEvent，纯函数）**：
- 群消息（chatType=2）：`message_type=group`、`group_id=Number(peerUid)`、sender role 默认 `member`（P2-3 接 cache）
- 私聊（chatType=1 / 100 临时）：`message_type=private`、`sub_type=friend/group`
- `message_id=Number(msgSeq)`（P2-3 换 MessageUnique：雪花 msgId → int32 稳定映射）
- message=canonicalToSegments(toCanonicalElements(msg))；raw_message=canonicalToCqMessage；time=msgTime/1000

**订阅/退订**：onStart 订阅 `Msg/onRecvMsg`（返回 unsubscribe），onStop 退订——协议层生命周期与 kernel 事件解耦。

**请求分发尚未接**：动作注册表 → network onRequest 分发、send_msg 真实调用 kernel apis/msg——下一步（P2-3）。

### 8.6 P2-3 请求分发 + send_msg 真实化 + MessageUnique（2026-08-05）

**MessageUnique（helper/message-unique.ts）**：OneBot `message_id`(int32) ↔ NT `msgId`(雪花字符串) 双向稳定映射。设计：

- 双向 Map + 递增计数器；溢出（>2^31-1）后从头分配已释放槽位（LRU 语义）。
- `alloc(msgId: string): number`（新消息取 id）、`getMsgId(id: number): string | undefined`、`getMessageId(msgId: string): number | undefined`、`release(msgId)`。
- 消息事件翻译用 `alloc`（收方向），send_msg 返回用 `getMessageId`。

**send_msg 真实化（action/send-msg.ts）**：注入 `deps: { msgApi: MsgApi }`。

- message 参数：string（CQ 码）→ `cqMessageToCanonical`；segment 数组 → `segmentsToCanonical`。
- 目标：`group_id` → `Peer{ chatType: GROUP, peerUid: String(group_id) }`（群消息 peerUid=群号，无需 uin→uid）；`user_id` 私聊需 uin→uid（BuddyService 探测后 P2-4 补，先明确 reject）。
- 返回真实 `message_id`（MessageUnique 映射 NT msgId）。

**请求分发（adapter.ts）**：`handleRequest(req, respond)`——OB11 标准 `{ action, params, echo }` → registry.get → handle/websocketHandle → respond。由装配方挂到 network transport 的 `onRequest`。

**动作注册表依赖注入（action/index.ts）**：`createOb11ActionRegistry(deps)`，SendMsgAction 收 msgApi。

### 8.7 查询动作真实化（2026-08-05，P2-4）

kernel 新增 `apis/group.ts`（GroupApi）与 `apis/friend.ts`（FriendApi），adapter 6 个查询动作从骨架变真实：

- **GroupApi**：getGroupList / getGroupInfo / getGroupMemberList / getGroupMemberInfo / uinToUid / uidToUin（getUidByUins/getUinByUids——uin↔uid 转换，**私聊发送也因此可补**）。
- **FriendApi**：getFriendList（buddyUids 拍平 + getBuddyNick/getBuddyRemark 补昵称备注）。
- **翻译模块（helper/translate.ts）**：NT GroupMember → OB11 GroupMemberInfo（role 映射 owner/admin/member，card=cardName，shut_up_timestamp=shutUpTime×1000，join_time/last_sent_time 数值化）；Group → GroupInfo。
- **动作改造**：GetGroupListAction / GetGroupInfoAction / GetGroupMemberListAction / GetGroupMemberInfoAction / GetFriendListAction 注入 GroupApi/FriendApi；GetLoginInfoAction 注入 self（uin/nickname）。deps 扩展 `{ sendMsg, groupApi, friendApi, self }`。
- **send_msg 私聊补全**：user_id(uin) → groupApi.uinToUid → Peer{chatType: C2C, peerUid: uid}。

### 8.8 P2-5 传输接入（2026-08-05）

`onebot11/transport.ts`：`assembleOb11Transports(opts)` 按配置装配 network 传输：

- **HTTP 反向**（http.enabled）：HttpServer + token 鉴权（Authorization: Bearer / access_token query）+ onRequest = adapter.handleRequest。
- **WS 反向**（ws.enabled）：WsServer + 鉴权 + 心跳 ping。
- **HTTP 正向上报**（httpPost.enabled）：HttpClient 注册 broadcaster（fire-and-forget）。
- **WS 正向**（wsReverse.enabled）：WsClient 双向（事件广播 + 请求响应）。

adapter onStart：装配传输 → 打开 server/client → 广播 lifecycle enable → 起心跳定时器（heartbeatInterval，0 关闭）。onStop：心跳/传输/退订全清理。BaseProtocolAdapter 增 `getBroadcaster()`（protected）。

### 8.9 P2-6 cli 启动编排（2026-08-05）

**boot.cjs 补协议装配**（loader runtime）：登录成功后动态 import adapter/network 入口（launcher 环境变量 NAPUTO_ADAPTER_ENTRY / NAPUTO_NETWORK_ENTRY）→ 创建 MsgChannel + MsgBridge + MsgApi/GroupApi/FriendApi + EventBroadcaster + NapukettoOneBot11Adapter → start。

### 8.14 P2-14 第五批动作（文件类 + 资料 + 点赞 + 翻译，2026-08-05 设计 + 实现）

**目标**：HANDOVER.md §5.3 第五批中不依赖 OIDB 的部分。kernel 方法面见 kernel design §8.16。**已实现并 pnpm check 全绿（145 文件）+ 全量构建通过。**

**群文件类（8 个，group/）**：
- `get_group_root_files`：getGroupFileList(groupCode, {sortType, fileCount, startIndex, sortOrder, showOnlinedocFolder}) → files（fileInfo）/ folders（folderInfo）
- `get_group_files_by_folder`：folder_id → 同上（parent=文件夹）
- `get_group_file_system_info`：getGroupFileList 的 groupSpaceResult → { file_count, limit_count, used_space, total_space }
- `create_group_file_folder`：folder_name → createGroupFolder
- `delete_group_file`：file_id → deleteGroupFile(groupCode, [102], [file_id])
- `delete_group_folder`：folder_id → deleteGroupFolder
- `rename_group_file`：file_id/name → renameGroupFile（参数待探测校准）
- `move_group_file`：file_id/folder → moveGroupFile
- `trans_group_file`：file_id → transGroupFile

**系统类（4 个，system/）**：
- `set_self_longnick`：longNick → ProfileApi.setLongNick
- `set_qq_profile`：nickname/personal_note → setNickName + setLongNick（sex 忽略）
- `set_qq_avatar`：file → ProfileApi.setHeader（本地路径，URL 先下载再设置）
- `translate_en2zh`：words → RichMediaApi.translateWords → { words }

**好友类（1 个，friend/）**：`send_like`：user_id → uinToUid → ProfileLikeApi.sendLike(uid, times)

**消息类（2 个，message/）**：`get_image` / `get_record`：message_id 反查 → fetchMsgsByMsgId → 找 PIC/PTT 元素 → { file: 本地路径, url, file_size, file_name }（简化版：返回元素已有路径+URL，不做主动下载/转码）

**deps 扩展**：`richMediaApi` / `profileApi` / `profileLikeApi`；boot.cjs 装配。

**跳过**：get_rkey/ocr_image/闪传/戳一戳（OIDB 或 NodeMiscService）/ get_essence_msg_list（pskey+WebApi）/ upload_group_file / get_group_file_url / get_online_clients。

### 8.13 P2-13 第四批动作（ticket + 群系统消息 + 已读别名，2026-08-05 设计 + 实现）

**目标**：HANDOVER.md §5.3 第四批中不依赖未探测 service 的部分。kernel 方法面见 kernel design §8.15。**已实现并 pnpm check 全绿（133 文件）+ 全量构建通过。**

**ticket 类（2 个）**：
- `get_clientkey`：TicketApi.getClientKey → `{ clientKey, keyIndex, expireTime, url }`
- `get_cookies`：user_id 缺省 self uin（NapCat 用 selfInfo）→ TicketApi.getCookies(domain, uin) → dict

**已读别名（2 个）**：`mark_private_msg_as_read`（user_id → C2C markRead）/ `mark_group_msg_as_read`（group_id → GROUP markRead）——复用 MarkMsgAsReadAction 逻辑薄封装。

**群系统（3 个）**：
- `set_group_add_request`：flag=seq → getSingleScreenNotifies(doubt, count) 匹配 → handleGroupRequest（approve→KAGREE / 拒绝→KREFUSE，reason 默认空格）
- `get_group_system_msg`：getSingleScreenNotifies(false, count) → type 1=invited_requests / 7=join_requests（OB11 结构：request_id/invitor_uin/invitor_nick/group_id/message/group_name/checked/actor/requester_nick；InvitedRequest 兼容别名）
- `get_group_shut_list`：getGroupShutUpMemberList → [{ user_id, nickname, shut_up_time }]（uin 经 uidToUin）

**deps**：无需新增；get_cookies 用 deps.self.uin，get_group_shut_list 用 uidToUin。

**跳过**（依赖未探测 service）：send_like / get_online_clients / get_rkey / ocr_image / get_image / get_record / set_qq_profile / set_qq_avatar / 文件类 / get_essence_msg_list。

### 8.12 P2-12 第三批动作（合并转发 + 在线状态 + 单条转发 + 文件下载 + 进程，2026-08-05 设计 + 实现）

**目标**：HANDOVER.md §5.3 第三批。kernel 方法面见 kernel design §8.14。**已实现并 pnpm check 全绿（124 文件）+ 全量构建通过。**

**合并转发（3 个）**：
- `send_group_forward_msg` / `send_private_forward_msg`：messages 每项 `{ id }`（node 元素）→ 经 MessageUnique 反查源 msgId+peer → 目标 peer（群直通 / 私聊 uinToUid）→ `sendForwardMessage`
- `get_forward_msg`：message_id/id → 反查 → `fetchForwardMessage` → 每条 toOb11MessageInfo → `{ messages }`

**单条转发（2 个）**：`forward_group_single_msg` / `forward_friend_single_msg`：message_id 反查源 + group_id/user_id 目标 → `forwardSingleMessage`

**在线状态（2 个）**：`set_online_status`（status/ext_status/battery_status）→ setOnlineStatus；`set_diy_online_status`（wording/face_id）→ customStatus

**文件下载 + 进程（3 个）**：
- `download_file`：url → fetch 下载 → 存 deps.system.cacheDir → `{ file }`（file 路径）
- `bot_exit`：deps.system.exit 回调（boot.cjs 注入 process.exit）→ 默认抛错提示未配置
- `set_restart`：deps.system.restart 回调（默认等同 bot_exit，重启交给装配方）

**deps 扩展**：`system` 加 `cacheDir?: string` / `exit?: () => Promise<void>` / `restart?: () => Promise<void>`；adapter 构造选项加 `cacheDir?` / `exit?` / `restart?`；boot.cjs 装配 cacheDir=paths.cacheDir、exit/restart=进程回调。

**跳过**（依赖未探测 service ★）：send_like / get_cookies / get_clientkey / get_rkey / get_online_clients / ocr_image / get_image / get_record / 文件类。

### 8.11 P2-11 第二批动作（好友 + 系统 + 消息剩余，2026-08-05 设计 + 实现）

**目标**：HANDOVER.md §5.3 第二批。kernel 方法面见 kernel design §8.13。**已实现并 pnpm check 全绿（117 文件）+ 全量构建通过。**

**好友类动作（6 个）**：
- `set_friend_add_request`：flag=reqTime → getBuddyReqList 匹配 → handleFriendRequest(notify, approve) + optional remark（remark 用 notify.friendUid，无需 uin→uid）
- `set_friend_remark`：user_id → uinToUid → setFriendRemark
- `delete_friend`：user_id → uinToUid → deleteFriend
- `get_friends_with_category`：getFriendCategories → 分类结构（buddyList 元素含 uin/nick/remark，uid→Friend 映射来自 getFriendList）
- `get_doubt_friends_add_request`：count → getDoubtFriendRequest
- `set_doubt_friends_add_request`：flag=uid → handleDoubtFriendRequest

**系统类动作（6 个）**：
- `get_status`：本地 `{ online: true, good: true }`（与心跳 status 同构 OB11Status）
- `get_version_info`：deps.system.appVersion → VersionInfo（app_name="napuketto-qq" / protocol_version="v11"）
- `clean_cache`：deps.system.cleanCache 回调（未配置抛错）
- `can_send_image` / `can_send_record`：本地 true
- `get_robot_uin_range`：本地 `{ min: 10001, max: 4294967295 }`

**消息类动作（1 个）**：`set_input_status`：user_id → uinToUid → setInputStatus(peer, eventType=1)。

**deps 扩展**：`Ob11ActionDeps` 加 `system: { appVersion: string; cleanCache: () => Promise<void> }`；adapter `OneBot11AdapterOptions` 加 `appVersion?` / `cleanCache?`；boot.cjs 装配传 `appVersion=NAPUTO_QQ_VERSION`、`cleanCache=paths.clearCache()`（kernel.PathWrapper）。

**跳过**（依赖未探测 service ★）：send_like / set_online_status / set_diy_online_status / get_cookies / get_clientkey / get_rkey / get_stranger_info / set_qq_profile / get_online_clients。

### 8.10 P2-10 第一批动作全量（消息 + 群管，2026-08-05 设计 + 实现）

**目标**：HANDOVER.md §5.3 第一批动作。kernel 方法面见 kernel design §8.12。**已实现并 pnpm check 全绿（103 文件）+ 全量构建通过。**

**MessageUnique 扩展**：`alloc(msgId, peer?)` 记录 Peer（delete_msg / get_msg / essence / emoji_like / fetch_ptt_text 只有 message_id，必须反查 peer + msgId）；`getPeer(msgId)`；新增 `resolveMsgIdAndPeer(messageId, unique)` 共享反查（消息不存在抛 KernelError NOT_FOUND → OB11 错误码 102）。NapCat 同款（getMsgIdAndPeerByShortId）。**关键：adapter.ts 消息事件翻译的 alloc 也传 peer**——收方向就记录，之后动作才能反查。

**新增 helper**：`toOb11MessageInfo(msg, unique)` —— RawMessage → OB11 消息信息结构（get_msg / 历史消息返回用；事件翻译 `toOb11MessageEvent` 是另一套带 self_id/post_type 的格式，不复用）。

**消息类动作**（9 个）：
- `send_private_msg` / `send_group_msg`：抽 `sendOb11Message(payload, deps)` 共享核心（resolvePeer + canonical 翻译 + auto_escape），SendMsgAction 与新动作复用（_handle 非 async 直接 return，规避 useAwait）
- `delete_msg`：message_id → msgId + peer → recallMessage
- `get_msg`：message_id → msgId + peer → fetchMsgsByMsgId → toOb11MessageInfo
- `get_group_msg_history` / `get_friend_msg_history`：peer + count → fetchMessages → 数组翻译；message_seq 为 OB11 message_id 时经 MessageUnique 反查起始 msgId
- `mark_msg_as_read`：user_id/group_id 二选一（refine）→ markRead
- `set_msg_emoji_like`：message_id → 拉消息取 msgSeq → setMsgEmojiLike
- `fetch_ptt_text`：message_id → fetchPttText → { text }

**群管类动作**（10 个）：set_group_kick（refuseForever → kickMemberV2 optFlag）/ set_group_ban（duration 秒，0 解禁）/ set_group_whole_ban / set_group_admin（role 注解 NTGroupMemberRole 字面量坑：let role: NTGroupMemberRole）/ set_group_card / set_group_name / set_group_leave（is_dismiss）/ set_essence_msg / delete_essence_msg / get_group_at_all_remain。user_id 一律 uin→uid；**set_group_special_title 不实现**（OIDB 依赖，见 kernel design §8.12）。

**注册**：deps 复用现有 `{ sendMsg, groupApi, friendApi, self }`，无需新增依赖；精华消息动作组合 `{ groupApi, messageUnique }`（sendMsg 无 groupApi）。

**踩坑**：exactOptionalPropertyTypes 下 `{ msgId: string | undefined }` 不能直接传可选参数 → if 分支构造 opts；kernel 产物未重建时 adapter 报 TS2339（先 build kernel 再 check）。

**cli（apps/cli）**：参数解析（-q 账号 / --data-dir / --config）→ locate QQ → launchQqWithLoader（BootMain 拉起 QQ + 注入）→ 常驻等待。
