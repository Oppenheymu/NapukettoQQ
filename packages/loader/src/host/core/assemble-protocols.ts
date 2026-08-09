/**
 * assemble-protocols.ts：OB11 / Satori 协议装配（非 IPC 模式，cli pnpm start）。
 * 2026-08-08：从 protocols.ts 拆分——protocols.ts 只留入口 + IPC 分支。
 */
import { join } from "node:path";
import { env } from "../env.js";
import { loadProtocolSections } from "../load-config.js";
import type { KernelLike, LoginResultLike } from "../types.js";
import { errMsg, log } from "../util.js";
import type { KernelServices } from "./kernel-services.js";

/** Windows 反斜杠（file:// URL 化时替换）。 */
const BACKSLASH_RE = /\\/g;
/** adapter 入口 index.mjs 后缀（子路径导出替换用）。 */
const INDEX_MJS_RE = /index\.mjs$/;

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

/** 装配 OB11 + Satori 适配器（登录成功后，非 IPC 模式）。 */
export async function assembleOb11AndSatori(
    kernel: KernelLike,
    services: KernelServices,
    loginResult: LoginResultLike,
): Promise<void> {
    const adapterEntry = env.NAPUTO_ADAPTER_ENTRY;
    const networkEntry = env.NAPUTO_NETWORK_ENTRY;
    if (!adapterEntry || !networkEntry) {
        log("bootstrap: NAPUTO_ADAPTER_ENTRY/NETWORK_ENTRY 未设置，跳过协议装配");
        return;
    }
    try {
        const network = (await import(
            `file://${networkEntry.replace(BACKSLASH_RE, "/")}`
        )) as unknown as NetworkModuleLike;
        // adapter 子路径导出（ADR-014）：onebot11 面（ob11ConfigSchema/
        // NapukettoOneBot11Adapter）走 ./onebot11，core 框架（ProtocolConfig）走 ./core。
        const onebot11Entry = adapterEntry.replace(INDEX_MJS_RE, "onebot11/index.mjs");
        const satoriEntry = adapterEntry.replace(INDEX_MJS_RE, "satori/index.mjs");
        const coreEntry = adapterEntry.replace(INDEX_MJS_RE, "core/index.mjs");
        const adapter = (await import(
            `file://${onebot11Entry.replace(BACKSLASH_RE, "/")}`
        )) as unknown as Onebot11ModuleLike;
        const satoriAdapter = (await import(
            `file://${satoriEntry.replace(BACKSLASH_RE, "/")}`
        )) as unknown as SatoriModuleLike;
        const adapterCore = (await import(
            `file://${coreEntry.replace(BACKSLASH_RE, "/")}`
        )) as unknown as AdapterCoreModuleLike;

        const { channel, groupCache } = services;
        const broadcaster = new network.EventBroadcaster();
        // 全局 TOML 配置段：按登录账号 uin 从 accounts 取 [onebot11] / [satori] 段作 seed
        // （2026-08-08 结构拍板：协议配置嵌在账号内；未配置协议的账号不装配对应协议）。
        const { cfgFile, ob11Section, satoriSection } = loadProtocolSections(
            kernel,
            loginResult.uin,
        );
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
            msgApi: services.msgApi,
            groupApi: services.groupApi,
            groupNotifyApi: services.groupNotifyApi,
            friendApi: services.friendApi,
            ticketApi: services.ticketApi,
            richMediaApi: services.richMediaApi,
            profileApi: services.profileApi,
            profileLikeApi: services.profileLikeApi,
            webApi: services.webApi,
            // P2-16：api/ 聚合（self + system 回调合并为一个对象）
            self: services.self,
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
            msgApi: services.msgApi,
            groupApi: services.groupApi,
            groupNotifyApi: services.groupNotifyApi,
            friendApi: services.friendApi,
            profileApi: services.profileApi,
            self: services.self,
            cacheDir: satoriCacheDir,
            groupCache,
        });
        await satori.start();
        log("bootstrap: satori adapter started");
    } catch (e) {
        log(`bootstrap: 协议装配失败: ${errMsg(e)}`);
    }
}
