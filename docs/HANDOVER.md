# NapukettoQQ 交接文本（2026-08-05 深夜）

> 新对话开场必读：本文件 + `AGENTS.md` + `docs/architecture.md` + 各包 `docs/design.md` + `/memories/repo/project-status.md`。
>
> 工作区干净，HEAD = `a435d89`，`pnpm check` 全绿（83 文件）。

---

## 1. 项目定位与技术路线

NapukettoQQ：基于 QQ NT 客户端原生模块（`wrapper.node`）的机器人框架，对外提供 OneBot 11（当前）/ OneBot 12 / Satori（规划）多协议接口。pnpm monorepo + TypeScript + tsdown + biome。

**技术路线（2026-08-05 定稿，AGENTS.md 第 7 条）**：
- **NAPI 范式**：wrapper.node 只能在 QQ 定制版 Electron 主进程内由 preload 注册（纯 Node/普通 Electron 报 "Module did not self-register"）。
- `@napuketto/loader` 注入 hook DLL 把 boot JS 引导进 QQ 主进程，截获 wrapper.node 的 `module.exports`，业务层全部走 NAPI 对象调用。
- **绝对禁止**：koffi、手算 vtable 槽位、内存偏移/memcpy 结构体、绕过 NAPI 的 thiscall 裸调；禁止修改 QQ 安装目录。
- **零引入 NapCat 代码**（GPL-2.0 与 GPL-3.0 不兼容）：NapCat 公开源码/类型仅作「说明书」理解 QQ wrapper 外部契约，接口自研描述。

**硬性约束**：kernel 是唯一原生交互层；network 协议无关；media 严格解耦；不做 framework 模式 / webui；禁止 `any`；异步必须 await/.catch；错误抛类型化 `KernelError`；日志走 pino；space+4 缩进 LF 行尾。

---

## 2. 当前进度（commit 链，时间正序）

```
a435d89 chore: biome.json 格式化
21cb14e feat(loader): boot.cjs QR 登录回退（快速登录失败自动扫码）
4967f5a feat(kernel): core.login QR 回退（快速登录失败 → QR 登录）
c32615d feat(kernel): login.ts QR 登录状态机（§9 第 7 项）
dd1dd74 feat(kernel,adapter): P2-7 notice 事件链路（grayTip → OB11 notice）
f48a912 fix(cli): bin 指向 dist/index.mjs
4f26ea6 feat(cli,loader): P2-6 cli 启动编排 + boot.cjs 协议装配
3f4b590 feat(adapter): P2-5 传输接入（HTTP/WS + 鉴权 + 心跳 meta）
74bd862 feat(kernel,adapter): P2-4 查询动作真实化（apis/group + apis/friend）
1e4c014 feat(adapter): P2-3 请求分发 + send_msg 真实化 + MessageUnique
aa356d2 feat(adapter): onebot11 adapter 实现（消息收链路）
0f499fc feat(kernel): 消息事件链路（MsgBridge + toCanonicalElements）
9a096b1 feat(kernel): apis/msg 实现（P2-1）
ab7cb84 feat(kernel): 装配层 NapukettoCore + CoreContext（§9 第 6 项）
b2574ec refactor(kernel): 解耦 wrapper-config/wrapper-adapters
470adfa fix(kernel): wrapper adapter 契约修正（普通 JS 对象）
0352af8 feat(kernel): 完整启动生命周期（lifecycle.ts）+ 类型体系重构
128cf6b feat(kernel): QQ 进程内探测（probe.ts）+ 主 session 复用
41a8ee9 feat(loader): 注入引导全链路实测打通（IAT hook v7）
96748f4 feat(kernel): NAPI 路线重构 + loader 包
```

**进度坐标**：kernel design.md §9 完成 8/9（login 完成，剩 cache/、apis 的 user/file/system）；**完整启动链路打通**（cli → 定位 QQ → BootMain 注入 → boot.cjs 内 kernel 装配 + 快速登录/QR 回退 → adapter/network 协议装配 → HTTP/WS 监听 + 心跳）；**消息收发 + 6 查询动作 + notice 事件 + meta 事件 + QR 登录全部真实可用**；**第一批（消息 9 + 群管 10）+ 第二批（好友 6 + 系统 6 + 输入状态 1）NapCat API 已实现**。NapCat 对齐度 ≈ 50%。

---

## 3. 已完成功能清单

### 3.1 kernel（@napuketto/kernel）
- 基础设施：errors（KernelError + 8 错误码）/ paths（PathWrapper）/ logger（pino console+file+redact）/ config（ConfigBase 零 zod）/ event-channel（NTEventChannel 类型化 on/waitFor/emit）
- wrapper 层：wrapper-version（版本探测）/ wrapper-loader（createWrapper/initEngine/createSession/initSession/startSession/startNapuketto）/ wrapper-config（buildEngineConfig/buildLoginConfig/buildSessionConfig）/ wrapper-adapters（GlobalAdapter/DependsAdapter/DispatcherAdapter/createSessionListener/createLoginListener）
- 装配层：context（CoreContext）/ core（NapukettoCore.create/attachWrapper/login/stop）
- 登录：lifecycle（quickLogin/initAndStartSession）/ login（QrLoginSession 状态机 + selfInfo）/ core.login QR 回退（快速登录失败 → 二维码写缓存目录）
- 事件链路：msg-bridge（MsgBridge：原生 listener → NTEventChannel）/ types/listeners/msg
- apis：MsgApi（sendMessage/recallMessage/fetchMessages/markRead/fetchMsgsByMsgId/setMsgEmojiLike/fetchPttText/setInputStatus）/ GroupApi（列表/详情/成员/uin↔uid + kick/ban/role/card/name/quit/essence/at_all_remain）/ FriendApi（列表 + isBuddy + 好友请求/备注/删除/分类/可疑申请）
- types：wrapper.ts / services（msg-service/group-service/buddy-service，说明书参考自研描述）/ entities（ChatType/Peer/RawMessage/RawElement + grayTip 结构）/ message-element（toCanonicalElements/toSendElements 双向映射）

### 3.2 adapter（@napuketto/adapter）
- core：BaseProtocolAdapter / BaseAction / ActionRegistry / AdapterRegistry / ProtocolConfig
- onebot11：
  - adapter.ts：NapukettoOneBot11Adapter（收链路 + 发链路 handleRequest + 传输装配 + 心跳）
  - action/：**34 个动作真实化**（消息 11：send_msg/send_private_msg/send_group_msg/delete_msg/get_msg/双历史/mark_read/emoji_like/fetch_ptt_text/set_input_status；查询 6；群管 10；好友 6：set_friend_add_request/set_friend_remark/delete_friend/get_friends_with_category/双可疑申请；系统 6：get_status/get_version_info/clean_cache/can_send_image/can_send_record/get_robot_uin_range）+ error-map
  - helper/：config（ob11ConfigSchema）/ cqcode（CQ 码编解码）/ data（canonical↔OB11 翻译）/ translate（Group/GroupMember→OB11）/ message-unique（雪花 msgId↔int32 + peer 记录）/ message-info（get_msg 返回结构）/ message-event（消息事件翻译）/ notice（grayTip→OB11 notice）
  - transport.ts：assembleOb11Transports（HTTP/WS server+client + Bearer/access_token 鉴权）
  - event/：message/notice/request/meta 四类事件模型齐全
- onebot12 / satori：空壳（未开工）

### 3.3 network / media / loader / cli
- network：完整（HttpServer/HttpClient/WsServer/WsClient/EventBroadcaster）
- media：完整（image/audio(silk)/video(ffmpeg)）
- loader：注入引导全链路（launcher/locate-qq/boot.cjs/native）
- cli：commander 参数解析（-q/-d/--qq-path）→ runSingleAccount（定位 QQ → launch → 常驻）；config 子命令/supervisor 多账号未做

---

## 4. 核心实现细节（新对话必备，避免重复摸索）

### 4.1 wrapper 交互关键认知
- **exports 89 键无 NodeI*Adapter/Listener 构造器** → adapter/listener 一律传**普通 JS 对象**（NAPI 反射读取方法回调）。NapCat 同款机制。
- **session 获取链路**：`NodeIQQNTStartupSessionWrapper.create()` → `start()` → `getSessionIdList()` 返回 Map `{nt: "nt_3"}` → `getNTWrapperSession("nt_3")`。**但 getNTWrapperSession 返回的是空 session**（service 全 null）——QQ 已登录的 session 要拦截 `new NodeIQQNTWrapperSession()` 捕获（boot.cjs 的 Proxy 机制）。
- **登录链路**：`new NodeIQQNTWrapperSession()` + `loginService.initConfig({appid, clientVer, commonPath})` + `getLoginList()/quickLoginWithUin`（或 QR：`connect()` → `getQRCodePicture()` 触发 → 回调 `onQRCodeGetPicture`/`onQRCodeLoginSucceed`）+ `session.init(config, depends, dispatcher, listener)` + `startNT(0)`。
- **init 完成信号**：以 `onOpentelemetryInit(is_init===true)` 为主，`onSessionInitComplete(0)` 为辅。
- appid 兜底 `537237765`，qua `V1_WIN_NQ_<ver>_<build>_GW_B`。

### 4.2 消息事件链路
```
原生 onRecvMsg → MsgBridge（addKernelMsgListener 普通 JS 对象）
  → NTEventChannel<MsgListener, "Msg">（事件名 "Msg/onRecvMsg"）
  → NapukettoOneBot11Adapter.subscribe()
    → 有 grayTipElement → helper/notice.ts → OB11 notice 事件
    → 否则 → toCanonicalElements → canonicalToSegments → OB11 message 事件
  → broadcaster.emit → network 传输（WS client/HTTP POST 上报）
```

### 4.3 notice 事件（P2-7 关键机制）
NT QQ 的系统事件（撤回/群变动/禁言）通过**消息的灰色提示元素（grayTip）**广播，不是独立事件通道：
- `elementType === 8`（GRAY_TIP）+ `grayTipElement.subElementType`：
  - `1`(REVOKE) → group_recall（revokeElement.operatorUid）
  - `4`(GROUP) → groupElement.type：`1`=入群、`3`=退群、`6/7`=管理员设/取消、`8`=禁言（shutUp.duration 秒）
- uid→uin 需要批量转换：`collectGrayTipUids(msg)` → `groupApi.uidToUin(uids)` → 翻译纯函数。

### 4.4 MessageUnique
雪花 msgId（字符串）↔ OB11 message_id（int32）双向稳定映射：递增计数器 + 释放池复用 + 溢出线性扫描。`alloc(msgId)` 收事件用；send_msg 返回也走 alloc（同一映射空间）。

### 4.5 传输装配（P2-5）
`assembleOb11Transports({config, broadcaster, handleRequest})`：
- HTTP 反向（http.enabled）：HttpServer + token 鉴权
- WS 反向（ws.enabled）：WsServer + 鉴权 + 心跳 ping
- HTTP 正向上报（httpPost.enabled）：HttpClient 注册 broadcaster
- WS 正向（wsReverse.enabled）：WsClient 双向
- adapter onStart：装配 → 打开 → lifecycle enable → 心跳定时器（heartbeatInterval）

### 4.6 QR 登录（P2-8/9）
`QrLoginSession`（kernel/login.ts）状态机：`idle → waiting_scan → scanned → logged_in / failed`。
- `start({quickUin})`：addKernelLoginListener → connect() → 有账号 quickLoginWithUin / 无则 getQRCodePicture()
- 二维码过期（errType=1 errCode=3）自动 refresh()
- core.login 加 `qrFallback:true`：快速登录失败 → 自动 QR，二维码写缓存目录 qrcode.png

### 4.7 biome.json 特殊配置
- `preset: all`（全规则）→ probe.ts / notice.ts 有 override（关 noTernary/noMagicNumbers/useDestructuring/noContinue/复杂度）
- 已关：useExportsLast / useConsistentTypeDefinitions / noBarrelFile / noNodejsModules / useImportExtensions / noUnresolvedImports / useLiteralKeys / noProcessEnv / noSecrets / useErrorCause
- `exactOptionalPropertyTypes: true` 是常踩坑点：**可选属性不能显式赋 undefined**，需 if 分支或显式联合类型。

---

## 5. 下一步重点：全量实现 NapCat API（用户拍板）

## 5. 下一步重点：全量实现 NapCat API（用户拍板）

### 5.1 现状

✅ **第一批已实现（P2-10，2026-08-05）**：消息类 9 个（send_private_msg / send_group_msg / delete_msg / get_msg / get_group_msg_history / get_friend_msg_history / mark_msg_as_read / set_msg_emoji_like / fetch_ptt_text）+ 群管类 10 个（set_group_kick / ban / whole_ban / admin / card / name / leave / set_essence_msg / delete_essence_msg / get_group_at_all_remain）。**set_group_special_title 未实现**（NapCat 走 OIDB 自定义包，违反 NAPI 路线，待评估 sendSsoCmdReqByContend）。实现细节见 kernel design §8.12 + adapter design §8.10。

✅ **第二批已实现（P2-11，2026-08-05）**：好友类 6 个（set_friend_add_request / set_friend_remark / delete_friend / get_friends_with_category / get_doubt_friends_add_request / set_doubt_friends_add_request）+ 系统类 6 个（get_status / get_version_info / clean_cache / can_send_image / can_send_record / get_robot_uin_range）+ 消息类 1 个（set_input_status）。实现细节见 kernel design §8.13 + adapter design §8.11。

已实现动作总数 8 + 19 + 13 = **40 个**。

### 5.2 NapCat 动作全集（ActionName 清单，约 130+，来源 napcat-onebot/action/router.ts）
按 service 分组（**★ = 依赖未探测的 service**）：

**消息类（MsgService，方法面已探测 ✓）**：
```
send_private_msg / send_group_msg（sendMsg 包装）
delete_msg（recallMsg）
get_msg（getMsgsByMsgId）
get_group_msg_history / get_friend_msg_history（getMsgs）
send_group_forward_msg / send_private_forward_msg（multiForwardMsg）
get_forward_msg（getMultiMsg）
mark_msg_as_read / mark_private_msg_as_read / mark_group_msg_as_read（setMsgRead）
forward_friend_single_msg / forward_group_single_msg（forwardMsg）
set_msg_emoji_like（setMsgEmojiLikes）/ get_emoji_likes（getMsgEmojiLikesList）
fetch_ptt_text（translatePtt2Text）
send_like ★
get_online_clients（getOnLineDev）
set_online_status / set_diy_online_status（setStatus）
set_input_status（sendShowInputStatusReq）
```

**群管类（GroupService，方法面已探测 ✓）**：
```
set_group_kick（kickMemberV2）
set_group_ban（setMemberShutUp）
set_group_whole_ban（setGroupShutUp）
set_group_admin（modifyMemberRole）
set_group_card（modifyMemberCardName）
set_group_name（modifyGroupName）
set_group_remark（modifyGroupRemark）
set_group_leave（quitGroupV2）
set_group_special_title（modifyMemberCardName 或专用方法）
set_essence_msg / delete_essence_msg（addGroupEssence/removeGroupEssence）
get_essence_msg_list（fetchGroupEssenceList）
get_group_at_all_remain（getGroupRemainAtTimes）
get_group_honor_info（getGroupHonorList）
get_group_shut_list（getGroupShutUpMemberList）
set_group_add_request（operateSysNotify）
get_group_system_msg（getSingleScreenNotifies）
get_group_info_ex / get_group_detail_info（getGroupDetailInfo）
set_group_sign / send_group_sign（setGroupSign）
```

**好友类（BuddyService，方法面已探测 ✓）**：
```
set_friend_add_request（approvalFriendRequest）
set_friend_remark（setBuddyRemark）
delete_friend（delBuddy）
get_friends_with_category（getBuddyListV2 分类保留）
get_doubt_friends_add_request / set_doubt_friends_add_request（getDoubtBuddyReq/approvalDoubtBuddyReq）
get_stranger_info ★（ProfileService）
friend_poke ★
```

**系统类（部分需探测）**：
```
get_status / get_version_info（本地组装）
get_cookies / get_credentials / get_csrf_token ★（TicketService）
set_qq_profile / set_self_longnick ★（ProfileService）
set_qq_avatar ★
clean_cache（本地）
set_restart / bot_exit
get_clientkey ★ / nc_get_rkey ★ / get_rkey ★（TicketService）
get_robot_uin_range
translate_en2zh ★
ocr_image ★
get_record（RichMediaService + media 包转码）
get_image（RichMediaService）
can_send_image / can_send_record（本地 true）
download_file（HttpClient）
get_file ★（FileService）
```

**文件类（FileService ★ 未探测）**：
```
upload_group_file / upload_private_file
get_group_root_files / get_group_files_by_folder / get_group_file_url
get_group_file_system_info
delete_group_file / create_group_file_folder / delete_group_folder
move_group_file / trans_group_file / rename_group_file
get_private_file_url ★
send_online_file / receive_online_file / get_online_file_msg
```

**闪传/表情/其他扩展**（napcat 独有，可选）：
```
send_flash_msg / create_flash_task / get_flash_file_list
fetch_custom_face / add_custom_face / delete_custom_face
send_group_ark_share / send_ark_share
friend_poke / group_poke（sendPoke）
get_mini_app_ark / send_packet / get_ai_record（高级，最后）
```

### 5.3 实现策略（建议分批）
1. **第一批（消息 + 群管，最常用）**：把已探测的 MsgService/GroupService 方法面转化为动作。kernel apis/msg.ts 已覆盖 send/recall/fetch，需补：`getMsgsByMsgId`（get_msg）、`getMsgs`（历史）、`multiForwardMsg`（合并转发）、`setMsgEmojiLikes`、`translatePtt2Text`、`setStatus`、`setMemberShutUp`、`modifyMemberRole`、`modifyMemberCardName`、`modifyGroupName`、`kickMemberV2`、`quitGroupV2`、`setGroupShutUp`、`addGroupEssence` 等。
2. **第二批（好友 + 系统）**：BuddyService 已探测（approvalFriendRequest/setBuddyRemark/delBuddy）；系统类本地组装（get_status/get_version_info/clean_cache）。
3. **第三批（探测新 service）**：TicketService（get_cookies/get_credentials/get_clientkey）、ProfileService（get_stranger_info/set_qq_profile）、FileService（文件类）、RichMediaService（get_image/get_record）——先用 NapCat 公开类型作说明书写接口，再进程内探测校准。

### 5.4 动作注册模式（照抄现有）
```ts
// adapter/onebot11/action/<name>.ts
export class SetGroupKickAction extends BaseAction<Payload, Return> {
    readonly name = "set_group_kick";
    readonly schema = setGroupKickSchema;   // zod
    protected readonly errorCodeMap = ob11ErrorCodeMap;
    private readonly deps: Deps;
    constructor(deps: Deps) { super(); this.deps = deps; }
    protected async _handle(payload: Payload): Promise<Return> {
        // kernel apis 调用 → 翻译 OB11 返回
    }
}
// action/index.ts：deps 扩展 + registry.register(new XxxAction(deps.xxx))
```

### 5.5 关键提醒
- **批量实现时保持「一个模块一个模块」**：每批做完跑 `pnpm check`。
- **先补 kernel apis 方法面**（service 类型 + unwrap 解包），再写 adapter 动作（薄翻译）。
- **uid↔uin**：群聊目标用 groupCode（peerUid=群号）；私聊/user_id 需 `uinToUid`；成员 user_id 需 uidToUin。
- **动作 schema 参照 OB11 标准**（go-cqhttp 扩展字段可加 optional）。
- 探测脚本在 `packages/kernel/scripts/probe/`（gitignored），结论已归档 design.md §8.5。

---

## 6. 环境命令

```bash
pnpm install              # 安装依赖
pnpm check                # biome check + tsc --noEmit（提交前必跑）
pnpm fix                  # biome 自动修复 + tsc
pnpm -r build             # 全量构建（tsdown）
pnpm --filter @napuketto/kernel build   # 单包构建
pnpm --filter @napuketto/loader build   # 含 native 编译（build-native.mjs）
node apps/cli/dist/index.mjs --help     # cli 冒烟（不拉起 QQ）
```

**联调环境**：QQ 9.9.31-49919（`C:\Program Files\Tencent\QQNT\versions\9.9.31-49919`）。boot 日志：`<cfgDir>/napuketto-boot.log`。

---

## 7. 参考资源

- NapCat 公开类型（说明书，零复制）：
  - `packages/napcat-core/services/NodeIKernelMsgService.ts`（200+ 方法，已抓取）
  - `packages/napcat-core/services/NodeIKernelGroupService.ts`（已抓取）
  - `packages/napcat-core/services/NodeIKernelBuddyService.ts`（已抓取）
  - `packages/napcat-core/listeners/NodeIKernelGroupListener.ts`（已抓取）
  - `packages/napcat-core/types/element.ts` / `msg.ts` / `group.ts`（元素/实体结构，已抓取）
  - `packages/napcat-onebot/action/router.ts`（ActionName 全集，已抓取）
  - `packages/napcat-shell/base.ts`（登录/QR 流程，已抓取）
- 抓取方式：`https://raw.githubusercontent.com/NapNeko/NapCatQQ/main/<path>` + fetch_webpage，或 github_text_search。

---

## 8. 遗留事项（下次开工直接做）

1. ✅ **API 全量实现第一批**（消息 + 群管，P2-10 已完成）。
2. ✅ **API 第二批**（好友 + 系统 + set_input_status，P2-11 已完成）。
3. **API 第三批**：消息类剩余（send_like ★ / set_online_status / set_diy_online_status / get_online_clients / 合并转发 send_group_forward_msg/get_forward_msg）+ 系统类 ticket（get_cookies / get_clientkey / get_rkey ★ 需探测 TicketService/ProfileService/UserApi）+ 文件类（FileService ★）。**send_like/set_online_status 在 NapCat 走 UserApi（setSelfOnlineStatus/like），需先探测 user service 方法面**。
4. **api/ 聚合层**（adapter design §6 第 4 项）：目前动作直接注入 apis，设计上是 onebot11/api/ 聚合 + 缓存。
5. **cache/**（ADR-008）：群/成员/好友缓存，翻译层只读消费。GroupService.getAllMemberList 已探测（result.infos Map）。
6. **set_group_special_title**：OIDB 依赖（违反 NAPI 路线），待评估 `sendSsoCmdReqByContend(cmd, param)` 可行性。
7. cli config 子命令 + supervisor 多账号（P6）。
8. onebot12 / satori 空壳填充。
