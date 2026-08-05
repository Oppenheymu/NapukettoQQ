/**
 * wrapper.node 的 NAPI 接口面（自研描述，非移植）
 *
 * 来源：wrapper.node 在 QQ 定制版 Electron 里通过 napi_define_class / napi_set_named_property
 * 注册的 JS 类（2026-08-05 Ghidra 反编译 FUN_180c6274a / FUN_180c80224 确认类名）。
 * 这些接口是 wrapper.node 对外暴露的外部系统契约——我们自研描述其形状，未复制任何第三方代码。
 *
 * 注意：这里所有对象由 QQ 运行时的 NAPI 层自动构建/转换，业务层禁止触碰 C++ ABI。
 */

/** 平台类型（与 wrapper.node 的 platform 字段对应）。 */
export const PlatformType = {
    KUNKNOWN: 0,
    KANDROID: 1,
    KIOS: 2,
    KWINDOWS: 3,
    KMAC: 4,
    KLINUX: 5,
} as const;
export type PlatformType = (typeof PlatformType)[keyof typeof PlatformType];

/** 厂商类型（deviceInfo.vendorType）。 */
export const VendorType = {
    KNOSETONIOS: 0,
    KUNSUPPORTANDROIDPUSH: 1,
    KSUPPORTTPNS: 2,
    KSUPPORTHMS: 3,
    KSUPPORTOPPOPUSH: 4,
    KSUPPORTVIVOPUSH: 5,
    KSUPPORTGOOGLEPUSH: 99,
} as const;
export type VendorType = (typeof VendorType)[keyof typeof VendorType];

/** NodeQQNTWrapperUtil：通用工具类（静态服务）。 */
export interface NodeQQNTWrapperUtil {
    get(): NodeQQNTWrapperUtil;
    getNTUserDataInfoConfig(): string;
    // 文件/哈希工具（按需补齐，运行时反射枚举为准）
    getFileSize(path: string): Promise<number>;
    fileIsExist(path: string): unknown;
    makeDirByPath(path: string): unknown;
}

/** engine 初始化配置（initWithDeskTopConfig 第一参，JS 对象直接传）。 */
export interface EnginInitDesktopConfig {
    base_path_prefix: string;
    platform_type: PlatformType;
    app_type: 4;
    app_version: string;
    os_version: string;
    use_xlog: boolean;
    qua: string;
    global_path_config: {
        desktopGlobalPath: string;
    };
    thumb_config: { maxSide: 324; minSide: 48; longLimit: 6; density: 2 };
}

/** NodeIQQNTWrapperEngine：全局 engine（单例）。 */
export interface NodeIQQNTWrapperEngine {
    get(): NodeIQQNTWrapperEngine;
    initWithDeskTopConfig(config: EnginInitDesktopConfig, adapter: NodeIGlobalAdapter): void;
    initWithMobileConfig(config: unknown, adapter: NodeIGlobalAdapter): void;
    initLog(arg: unknown): void;
    setLogLevel(arg: unknown): void;
    onSendSSOReply(a: unknown, b: unknown, c: unknown, d: unknown, e: unknown): void;
}

/** desktopPathConfig 结构。 */
export interface DesktopPathConfig {
    account_path: string;
}

/** rdeliveryConfig 结构。 */
export interface RDeliveryConfig {
    appKey: string;
    systemId: number;
    appId: string;
    logicEnvironment: string;
    platform: PlatformType;
    language: string;
    sdkVersion: string;
    userId: string;
    appVersion: string;
    osVersion: string;
    bundleId: string;
    serverUrl: string;
    fixedAfterHitKeys: string[];
}

/** deviceInfo 结构。 */
export interface DeviceInfo {
    guid: string;
    buildVer: string;
    localId: number;
    devName: string;
    devType: string;
    vendorName: string;
    osVer: string;
    vendorOsName: string;
    setMute: boolean;
    vendorType: VendorType;
}

/** session.init 的完整配置（JS 对象，NAPI 自动转换）。 */
export interface WrapperSessionInitConfig {
    selfUin: string;
    selfUid: string;
    desktopPathConfig: DesktopPathConfig;
    clientVer: string;
    a2: string;
    d2: string;
    d2Key: string;
    machineId: string;
    platform: PlatformType;
    platVer: string;
    appid: string;
    rdeliveryConfig: RDeliveryConfig;
    defaultFileDownloadPath: string;
    deviceInfo: DeviceInfo;
    deviceConfig: string;
}

/** 会话监听器（init 第四参）。 */
export interface NodeIKernelSessionListener {
    onNTSessionCreate?(sessionId: string): void;
    onGProSessionCreate?(sessionId: string): void;
    onSessionInitComplete?(sessionId: string): void;
    onOpentelemetryInit?(info: { is_init: boolean; is_report: boolean }): void;
    onUserOnlineResult?(result: unknown): void;
    onGetSelfTinyId?(result: unknown): void;
}

/** NodeIQQNTWrapperSession：会话主入口。 */
export interface NodeIQQNTWrapperSession {
    getNTWrapperSession(name: string): NodeIQQNTWrapperSession;
    get(): NodeIQQNTWrapperSession;
    create(): NodeIQQNTWrapperSession;
    init(
        config: WrapperSessionInitConfig,
        depends: NodeIDependsAdapter,
        dispatcher: NodeIDispatcherAdapter,
        listener: NodeIKernelSessionListener,
    ): void;
    startNT(sessionId?: number): void;
    close(arg: unknown): void;
    onLine(arg: unknown): void;
    offLine(arg: unknown): void;
    disableIpDirect(arg: unknown): void;
    getAccountPath(arg: unknown): string;
    updateTicket(arg: unknown): void;
    // 60+ getService：运行时反射枚举后补齐
    getMsgService(): unknown;
    getGroupService(): unknown;
    getBuddyService(): unknown;
    getTicketService(): unknown;
    getRichMediaService(): unknown;
    getProfileService(): unknown;
}

/** NodeIQQNTStartupSessionWrapper：启动会话（可选）。 */
export interface NodeIQQNTStartupSessionWrapper {
    create(): NodeIQQNTStartupSessionWrapper;
    stop(): void;
    start(): void;
    createWithModuleList(uk: unknown): unknown;
    getSessionIdList(): Promise<Map<unknown, unknown>>;
}

/** NodeIKernelLoginService：登录服务。 */
export interface NodeIKernelLoginService {
    get(): NodeIKernelLoginService;
}

/** NodeIO3MiscService：O3 杂项服务。 */
export interface NodeIO3MiscService {
    get(): NodeIO3MiscService;
    addO3MiscListener(listener: unknown): number;
}

// adapter 类型（session.init 第二/三参、engine.initWithDeskTopConfig 第二参）
// 具体空实现类见 wrapper-loader.ts（NAPI 侧需要真实对象）。
// 用品牌字段避免空接口 lint（运行时反射后按需补齐方法）。
export interface NodeIGlobalAdapter {
    readonly adapterBrand?: "global";
}
export interface NodeIDependsAdapter {
    readonly adapterBrand?: "depends";
}
export interface NodeIDispatcherAdapter {
    readonly adapterBrand?: "dispatcher";
}

/** wrapper.node 的 NAPI 顶层导出（module.exports）。 */
export interface WrapperNodeApi {
    NodeIO3MiscService: NodeIO3MiscService;
    NodeQQNTWrapperUtil: NodeQQNTWrapperUtil;
    NodeIQQNTWrapperSession: NodeIQQNTWrapperSession;
    NodeIQQNTStartupSessionWrapper: NodeIQQNTStartupSessionWrapper;
    NodeIQQNTWrapperEngine: NodeIQQNTWrapperEngine;
    NodeIKernelLoginService: NodeIKernelLoginService;
}
