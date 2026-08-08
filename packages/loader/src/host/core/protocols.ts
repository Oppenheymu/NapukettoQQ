/**
 * protocols.ts：协议装配（登录成功后）。
 * 2026-08-07 阶段 2：由 runtime/boot-protocols.js TS 化（零语义改动）。
 * 动态 import adapter/network 入口，装配 OB11 / Satori 适配器。
 * 依赖 launcher 注入的 NAPUTO_ADAPTER_ENTRY / NAPUTO_NETWORK_ENTRY。
 *
 * 2026-08-08 FTA 优化：消息日志渲染 → msg-log.ts；TOML 配置段读取 → load-config.ts。
 */
import { join } from "node:path";
import { env } from "../env.js";
import { loadProtocolSections } from "../load-config.js";
import { setupMsgLogging } from "../msg-log.js";
import type { CoreContextLike, KernelLike, LoginResultLike } from "../types.js";
import { errMsg, log } from "../util.js";

/** network 包最小面（@napuketto/network，动态 import）。 */
interface NetworkModuleLike {
    EventBroadcaster: new () => unknown;
}

/** adapter 包 onebot11 子路径最小面（@napuketto/adapter，动态 import）。 */
interface Onebot11ModuleLike {
    ob11ConfigSchema: { parse(input: unknown): unknown };
    NapukettoOneBot11Adapter: new (
        options: Record<string, unknown>,
    ) => {
        start(): Promise<unknown>;
    };
}

/** adapter 包 satori 子路径最小面（@napuketto/adapter，动态 import）。 */
interface SatoriModuleLike {
    satoriConfigSchema: { parse(input: unknown): unknown };
    NapukettoSatoriAdapter: new (
        options: Record<string, unknown>,
    ) => {
        start(): Promise<unknown>;
    };
}

/** adapter 包 core 子路径最小面（ProtocolConfig 框架）。 */
interface AdapterCoreModuleLike {
    ProtocolConfig: new (options: Record<string, unknown>) => unknown;
}

/**
 * 登录成功后装配协议：kernel 各 Api + network 广播 + OB11 / Satori 适配器。
 */
export async function startProtocols(
    kernel: KernelLike,
    ctx: CoreContextLike,
    loginResult: LoginResultLike,
): Promise<void> {
    // 引导进程日志（ADR-007 统一规范：console pretty，格式与 kernel 一致；
    // base.name 用 pino 保留字段（logger name），pino-pretty 渲染为 (loader/pid)；
    // 文件日志由 kernel 装配负责）
    const logger = kernel.createLogger?.({ console: true, base: { name: "loader" } });
    const adapterEntry = env.NAPUTO_ADAPTER_ENTRY;
    const networkEntry = env.NAPUTO_NETWORK_ENTRY;
    if (!adapterEntry || !networkEntry) {
        log("bootstrap: NAPUTO_ADAPTER_ENTRY/NETWORK_ENTRY 未设置，跳过协议装配");
        return;
    }
    try {
        const network = (await import(
            `file://${networkEntry.replace(/\\/g, "/")}`
        )) as unknown as NetworkModuleLike;
        // adapter 子路径导出（ADR-014）：onebot11 面（ob11ConfigSchema/
        // NapukettoOneBot11Adapter）走 ./onebot11，core 框架（ProtocolConfig）走 ./core。
        const onebot11Entry = adapterEntry.replace(/index\.mjs$/, "onebot11/index.mjs");
        const satoriEntry = adapterEntry.replace(/index\.mjs$/, "satori/index.mjs");
        const coreEntry = adapterEntry.replace(/index\.mjs$/, "core/index.mjs");
        const adapter = (await import(
            `file://${onebot11Entry.replace(/\\/g, "/")}`
        )) as unknown as Onebot11ModuleLike;
        const satoriAdapter = (await import(
            `file://${satoriEntry.replace(/\\/g, "/")}`
        )) as unknown as SatoriModuleLike;
        const adapterCore = (await import(
            `file://${coreEntry.replace(/\\/g, "/")}`
        )) as unknown as AdapterCoreModuleLike;
        const session = ctx.session;
        if (!session) {
            log("bootstrap: session 为空，无法装配协议");
            return;
        }
        // 消息事件通道 + 桥
        const channel = new kernel.NTEventChannel("Msg");
        const bridge = new kernel.MsgBridge(session, channel);
        bridge.register();
        // 控制台消息日志（NapCat 同款：收到消息打印到控制台；渲染逻辑见 msg-log.ts）。
        setupMsgLogging(kernel, channel, logger);
        // kernel APIs
        const groupApi = new kernel.GroupApi(session);
        const msgApi = new kernel.MsgApi(session);
        const friendApi = new kernel.FriendApi(session, {
            uidToUin: (uids) => groupApi.uidToUin(uids),
        });
        // 群事件通道 + 桥 + 群缓存（ADR-008：事件主动维护 + 查询惰性回填）
        const groupChannel = new kernel.NTEventChannel("Group");
        const groupBridge = new kernel.GroupBridge(session, groupChannel);
        groupBridge.register();
        const groupCache = new kernel.GroupCache({ channel: groupChannel, groupApi });
        groupCache.register();
        const groupNotifyApi = new kernel.GroupNotifyApi(session);
        const ticketApi = new kernel.TicketApi(session);
        const richMediaApi = new kernel.RichMediaApi(session);
        const profileApi = new kernel.ProfileApi(session);
        const profileLikeApi = new kernel.ProfileLikeApi(session);
        // 群空间 web API（Cookie 经 TicketApi.getCookies 注入）
        const webApi = new kernel.WebApi({
            getCookies: (domain) => ticketApi.getCookies(domain, loginResult.uin),
        });
        // network 广播 + OB11 适配器
        const broadcaster = new network.EventBroadcaster();
        // 全局 TOML 配置段（<项目根>/napuketto.toml，[onebot11] / [satori] 段 seed）。
        const { cfgFile, ob11Section, satoriSection } = loadProtocolSections(kernel);
        const ob11Config = new adapterCore.ProtocolConfig({
            path: cfgFile,
            schema: adapter.ob11ConfigSchema,
            defaults: adapter.ob11ConfigSchema.parse({}),
            seed: adapter.ob11ConfigSchema.parse(ob11Section),
        });
        const ob11 = new adapter.NapukettoOneBot11Adapter({
            config: ob11Config,
            broadcaster,
            msgChannel: channel,
            msgApi,
            groupApi,
            groupNotifyApi,
            friendApi,
            ticketApi,
            richMediaApi,
            profileApi,
            profileLikeApi,
            webApi,
            // P2-16：api/ 聚合（self + system 回调合并为一个对象）
            self: { uin: loginResult.uin, nickname: loginResult.nick },
            system: {
                appVersion: env.NAPUTO_QQ_VERSION || "unknown",
                // clean_cache：清理 kernel 数据目录缓存（PathWrapper.clearCache）
                cleanCache: async () => {
                    const paths = new kernel.PathWrapper({
                        dataRoot: env.NAPKETTO_DATA,
                        account: loginResult.uin,
                    });
                    paths.clearCache();
                },
                // download_file：缓存目录
                cacheDir: join(env.NAPUTO_CFG_DIR || ".", "cache"),
                // bot_exit / set_restart：进程控制（退出 QQ 主进程由 launcher 观察）
                exit: async () => {
                    log("bootstrap: bot_exit 触发，退出 QQ 主进程");
                    process.exit(0);
                },
                restart: async () => {
                    log("bootstrap: set_restart 触发，退出 QQ 主进程（由 launcher 重启）");
                    process.exit(0);
                },
            },
            // P2-17：群/成员缓存（ADR-008，翻译层只读消费）
            groupCache,
        });
        await ob11.start();
        log("bootstrap: onebot11 adapter started");

        // Satori 协议（可选）：读 [satori] 段，装配 NapukettoSatoriAdapter。
        // 与 OB11 共用 kernel apis / 消息通道 / 广播器（多协议共存，各协议独立传输）。
        const satoriCacheDir =
            typeof satoriSection["cacheDir"] === "string" && satoriSection["cacheDir"] !== ""
                ? satoriSection["cacheDir"]
                : join(env.NAPUTO_CFG_DIR || ".", "cache");
        const satoriConfig = new adapterCore.ProtocolConfig({
            path: cfgFile,
            schema: satoriAdapter.satoriConfigSchema,
            defaults: satoriAdapter.satoriConfigSchema.parse({}),
            seed: satoriAdapter.satoriConfigSchema.parse(satoriSection),
        });
        const satori = new satoriAdapter.NapukettoSatoriAdapter({
            config: satoriConfig,
            broadcaster,
            msgChannel: channel,
            msgApi,
            groupApi,
            groupNotifyApi,
            friendApi,
            profileApi,
            self: { uin: loginResult.uin, nickname: loginResult.nick },
            cacheDir: satoriCacheDir,
            groupCache,
        });
        await satori.start();
        log("bootstrap: satori adapter started");
    } catch (e) {
        log(`bootstrap: 协议装配失败: ${errMsg(e)}`);
    }
}
