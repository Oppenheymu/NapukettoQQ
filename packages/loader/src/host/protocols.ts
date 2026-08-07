/**
 * protocols.ts：协议装配（登录成功后）。
 * 2026-08-07 阶段 2：由 runtime/boot-protocols.js TS 化（零语义改动）。
 * 动态 import adapter/network 入口，装配 OB11 适配器。
 * 依赖 launcher 注入的 NAPUTO_ADAPTER_ENTRY / NAPUTO_NETWORK_ENTRY。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "./env.js";
import type { CoreContextLike, KernelLike, LoginResultLike } from "./types.js";
import { errMsg, log } from "./util.js";

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

/** adapter 包 core 子路径最小面（ProtocolConfig 框架）。 */
interface AdapterCoreModuleLike {
    ProtocolConfig: new (options: Record<string, unknown>) => unknown;
}

/**
 * 登录成功后装配协议：kernel 各 Api + network 广播 + OB11 适配器。
 */
export async function startProtocols(
    kernel: KernelLike,
    ctx: CoreContextLike,
    loginResult: LoginResultLike,
): Promise<void> {
    // 引导进程日志（ADR-007 统一规范：console pretty，格式与 kernel 一致；
    // service=loader 标注来源；文件日志由 kernel 装配负责）
    const logger = kernel.createLogger?.({ console: true, base: { service: "loader" } });
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
        const coreEntry = adapterEntry.replace(/index\.mjs$/, "core/index.mjs");
        const adapter = (await import(
            `file://${onebot11Entry.replace(/\\/g, "/")}`
        )) as unknown as Onebot11ModuleLike;
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
        // 控制台消息日志（NapCat 同款：收到消息打印到控制台）。
        // 独立订阅，不干扰 adapter 的 OB11 翻译广播；解析纯函数无副作用（ADR-008）。
        // 走结构化日志（时间戳 + 级别 + pid + 元数据），boot 文件日志保留。
        // onRecvMsg 回调参数为消息数组（2026-08-07 运行时实证）——遍历逐条打印。
        channel.on("Msg/onRecvMsg", (msgs) => {
            const list = Array.isArray(msgs) ? msgs : [msgs];
            for (const msg of list) {
                if (!msg || typeof msg !== "object") {
                    continue;
                }
                try {
                    const texts = kernel
                        .toCanonicalElements(msg)
                        .filter((el) => el.type === "text")
                        .map((el) => el.text)
                        .join("");
                    const kind = msg.chatType === kernel.ChatType.GROUP ? "群聊" : "私聊";
                    const sender = msg.sendNickName || msg.senderUin || "?";
                    const peer = msg.peerName || msg.peerUin || "?";
                    const line = `📩 收到${kind}消息 来自=${sender} 会话=${peer}（${msg.peerUin ?? ""}）: ${texts}`;
                    log(line);
                    logger?.info(
                        { kind, sender, peer, peerUin: msg.peerUin ?? "", text: texts },
                        "收到消息",
                    );
                } catch (e) {
                    const line2 = `收到消息（解析失败: ${errMsg(e)}）`;
                    log(line2);
                    logger?.warn({ err: errMsg(e) }, "收到消息（解析失败）");
                }
            }
        });
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
        // 全局 TOML 配置（<项目根>/napuketto.toml，2026-08-07 用户拍板：配置文件放项目根）：
        // 读 [onebot11] 段，zod 校验后作 seed。路径优先级：NAPKETTO_CONFIG（launcher 注入）>
        // 装配链自身探测（kernel.resolveConfigPath）> NAPUTO_CFG_DIR 兜底（旧行为兼容）。
        // （ConfigBase seed 模式：load() 直接用内存值，不再读写独立协议文件）
        let ob11Section: Record<string, unknown> = {};
        const cfgFile = env.NAPKETTO_CONFIG || join(env.NAPUTO_CFG_DIR || ".", "napuketto.toml");
        try {
            const raw = readFileSync(cfgFile, "utf8");
            const parsed = kernel.parseToml(raw);
            if (parsed && typeof parsed["onebot11"] === "object" && parsed["onebot11"] !== null) {
                ob11Section = parsed["onebot11"] as Record<string, unknown>;
            }
        } catch (e) {
            log(`bootstrap: 全局配置读取失败（用默认 ob11 配置）: ${errMsg(e)}`);
        }
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
    } catch (e) {
        log(`bootstrap: 协议装配失败: ${errMsg(e)}`);
    }
}
