/**
 * kernel-services.ts：kernel 业务服务装配（IPC 模式与协议模式共用）。
 *
 * 登录成功后创建：消息/群事件通道 + 桥 + 缓存 + kernel 各 Api + 自身信息。
 * IPC 模式（koishi 插件）经此拿服务装配 ipc-server；非 IPC（cli）经此拿服务
 * 装配 OB11/Satori 适配器。
 */

import { setupMsgLogging } from "../msg-log.js";
import type { CoreContextLike, EventChannelLike, KernelLike, LoginResultLike } from "../types.js";
import { log } from "../util.js";

/** kernel 业务服务集合（引导装配产物，协议/IPC 共用）。 */
export interface KernelServices {
    kernel: KernelLike;
    ctx: CoreContextLike;
    logger: unknown;
    /** 消息事件通道（Msg/onRecvMsg 等）。 */
    channel: EventChannelLike;
    /** 群事件通道（Group/onGroupListUpdate 等）。 */
    groupChannel: EventChannelLike;
    /** kernel apis（宽松 unknown，装配方按需断言——OB11 用完整面，IPC 动作表用最小面）。 */
    msgApi: unknown;
    groupApi: unknown;
    friendApi: unknown;
    groupCache: unknown;
    groupNotifyApi: unknown;
    ticketApi: unknown;
    richMediaApi: unknown;
    profileApi: unknown;
    profileLikeApi: unknown;
    webApi: unknown;
    /** 登录账号自身信息（login.getSelf）。 */
    self: { uin: string; nickname: string };
    /** wrapper session（诊断用：IPC 动作表枚举/触发原生服务）。 */
    session: unknown;
    /** wrapper engine（诊断用：initLog 等初始化方法验证）。 */
    engine: unknown;
    /** NodeQQNTWrapperUtil（诊断用：原生 copyFile 验证富媒体文件放置）。 */
    util: unknown;
}

/** 登录成功后创建 kernel 业务服务（channel/bridge/cache/apis）。失败返回 null。 */
export async function createKernelServices(
    kernel: KernelLike,
    ctx: CoreContextLike,
    loginResult: LoginResultLike,
): Promise<KernelServices | null> {
    const logger = kernel.createLogger?.({ console: true, base: { name: "loader" } });
    const session = ctx.session;
    if (!session) {
        log("bootstrap: session 为空，无法创建 kernel 服务");
        return null;
    }
    // 消息事件通道 + 桥
    const channel = new kernel.NTEventChannel("Msg");
    const bridge = new kernel.MsgBridge(session, channel);
    bridge.register();
    // 控制台消息日志（NapCat 同款：收到消息打印到控制台；渲染逻辑见 msg-log.ts）。
    setupMsgLogging(kernel, channel, logger);
    // kernel APIs
    const groupApi = new kernel.GroupApi(session);
    // channel 传入 MsgApi：sendMsg 后等 onMsgInfoListUpdate 确认（NapCat 式，2026-08-11）
    const msgApi = new kernel.MsgApi(session, channel);
    const friendApi = new kernel.FriendApi(session, {
        uidToUin: (uids: string[]) => groupApi.uidToUin(uids),
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
        getCookies: (domain: string) => ticketApi.getCookies(domain, loginResult.uin),
    });
    return {
        kernel,
        ctx,
        logger,
        channel,
        groupChannel,
        msgApi,
        groupApi,
        friendApi,
        groupCache,
        groupNotifyApi,
        ticketApi,
        richMediaApi,
        profileApi,
        profileLikeApi,
        webApi,
        self: { uin: loginResult.uin, nickname: loginResult.nick ?? "" },
        session,
        engine: ctx.engine,
        // util：wrapper exports 上的 NodeQQNTWrapperUtil（诊断用原生 copyFile）
        util: (ctx as unknown as { exports?: { NodeQQNTWrapperUtil?: unknown } }).exports
            ?.NodeQQNTWrapperUtil,
    };
}
