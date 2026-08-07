/**
 * types.ts：自建宿主引导的类型层（2026-08-07 阶段 2 新增）。
 *
 * 与 @napuketto/kernel 的最小交互面（KernelLike 等）——自研描述，避免包级依赖：
 * loader 运行时通过 file:// 动态 import kernel，编译期不建立 workspace 依赖，
 * 因此这里用「最小接口」描述 kernel 的契约（类型层自研，与 kernel 实现解耦，
 * 由运行时行为实证维护，勿臆造成员）。
 */
/** 消息事件通道（NTEventChannel 的最小面）。 */
export interface EventChannelLike {
    on(event: string, handler: (payload: unknown) => void): unknown;
}

/** 事件桥（MsgBridge 最小面）。 */
export interface BridgeLike {
    register(): void;
    unregister(): void;
}

/** 群 API 最小面（uin↔uid 双向映射）。 */
export interface GroupApiLike {
    uidToUin(uins: string[]): Promise<Map<string, string>>;
    uinToUid(uins: string[]): Promise<Map<string, string>>;
}

/** 消息 API 最小面。 */
export interface MsgApiLike {
    sendMessage(
        peer: { chatType: number; peerUid: string },
        elements: CanonicalElementLike[],
    ): Promise<{ msgId: string }>;
    fetchMessages(peer: unknown, options: { count: number }): Promise<RawMessageLike[]>;
}

/** 原始消息（kernel RawMessage 最小面，字段宽松——运行时反射实证）。 */
export interface RawMessageLike {
    chatType?: unknown;
    sendNickName?: unknown;
    senderUin?: unknown;
    peerName?: unknown;
    peerUin?: unknown;
    msgId?: unknown;
    msgSeq?: unknown;
}

/** canonical 消息元素（text/at/face/...，kernel toCanonicalElements 输出）。 */
export interface CanonicalElementLike {
    type: string;
    text?: string;
}

/** 登录结果（kernel LoginResult 最小面）。 */
export interface LoginResultLike {
    uin: string;
    uid: string;
    nick?: string;
}

/** 登录账号（kernel listLoginAccounts 返回项）。 */
export interface LoginAccountLike {
    uin: string;
    nickName?: string;
    isQuickLogin?: boolean;
}

/** CoreContext（kernel NapukettoCore.create → attachWrapper 返回）。 */
export interface CoreContextLike {
    session: unknown;
    engine?: unknown;
    login?: { uin?: string; uid?: string; nick?: string };
    /** 老 kernel 回退路径（startNapuketto 手工 lifecycle）。 */
    loginService?: { initConfig(config: unknown): void };
}

/** NapukettoCore（kernel 装配层）。 */
export interface CoreLike {
    attachWrapper(wrapperExports: unknown, env: Record<string, unknown>): CoreContextLike;
    login(options: Record<string, unknown>): Promise<LoginResultLike | null>;
    setSession(session: unknown): void;
}

/** kernel probeRuntime 结果。 */
export interface ProbeResultLike {
    session?: unknown;
    services?: Record<string, unknown>;
}

/**
 * 与 @napuketto/kernel 的最小交互面。
 * 可选成员 = 老 kernel 兼容路径（startNapuketto/quickLogin 等回退分支）；
 * 必选成员 = 自建宿主主路径（2026-08-07 实测）必须存在。
 */
export interface KernelLike {
    // 装配层
    NapukettoCore?: {
        create(options: {
            paths: { dataRoot?: string | undefined };
            logLevel?: string | undefined;
        }): CoreLike;
    };
    startNapuketto?: (options: {
        wrapperExports: unknown;
        env: Record<string, unknown>;
    }) => CoreContextLike;
    // 登录
    listLoginAccounts(ctx: CoreContextLike): Promise<LoginAccountLike[]>;
    quickLogin?: (ctx: CoreContextLike, options: unknown) => Promise<LoginResultLike>;
    buildLoginConfig?: (appid: number, version: string, dataDir: string) => unknown;
    // session
    getMainSession?: (ctx: CoreContextLike) => unknown;
    buildSessionConfig(options: unknown): unknown;
    createLifecycleSessionListener(): unknown;
    initAndStartSession(
        ctx: CoreContextLike,
        config: unknown,
        listener: unknown,
        options: { timeoutMs: number },
    ): Promise<unknown>;
    waitSessionReady(ctx: CoreContextLike, options: { timeoutMs: number }): Promise<unknown>;
    // 路径 / appid
    parseAppidFromMajor?: (majorPath: string) => number | undefined;
    resolveAppidQua?: (qqVersion: string) => { appid: number };
    resolveQqUserDataRoot?: (wrapperExports: unknown) => string | null;
    resolveQqGlobalPath?: (qqDataRoot: string) => string;
    // 探测
    probeRuntime?: (ctx: CoreContextLike, filename?: string) => ProbeResultLike;
    // 消息 / 桥 / 服务
    // ChatType 是 kernel 常量对象（GROUP/C2C），Record 字面量键规避 useNamingConvention
    ChatType: Record<"GROUP" | "C2C", number>;
    toCanonicalElements(msg: unknown): CanonicalElementLike[];
    parseToml(raw: string): Record<string, unknown>;
    NTEventChannel: new (name: string) => EventChannelLike;
    MsgBridge: new (session: unknown, channel: EventChannelLike) => BridgeLike;
    MsgApi: new (session: unknown) => MsgApiLike;
    GroupApi: new (session: unknown) => GroupApiLike;
    FriendApi: new (
        session: unknown,
        deps: { uidToUin: (uins: string[]) => Promise<Map<string, string>> },
    ) => unknown;
    GroupBridge: new (session: unknown, channel: EventChannelLike) => { register(): void };
    GroupCache: new (options: {
        channel: EventChannelLike;
        groupApi: GroupApiLike;
    }) => { register(): void };
    GroupNotifyApi: new (session: unknown) => unknown;
    TicketApi: new (
        session: unknown,
    ) => {
        getCookies(domain: string, uin: string): Promise<Record<string, string>>;
    };
    RichMediaApi: new (session: unknown) => unknown;
    ProfileApi: new (session: unknown) => unknown;
    ProfileLikeApi: new (session: unknown) => unknown;
    WebApi: new (options: {
        getCookies: (domain: string) => Promise<Record<string, string>>;
    }) => unknown;
    PathWrapper: new (options: {
        dataRoot?: string | undefined;
        account: string;
    }) => {
        clearCache(): void;
    };
}
