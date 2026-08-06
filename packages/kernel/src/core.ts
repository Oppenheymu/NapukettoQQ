/**
 * NapukettoCore：装配 + 启动（§9 第 6 项，2026-08-05 实现）
 *
 * 装配：paths（建目录）→ logger → CoreContext。
 * 启动：attachWrapper（wrapperExports → startNapuketto）→ login（快速登录 → session.init）。
 *
 * 典型用法（boot.cjs 截获 exports 后）：
 *   const core = await NapukettoCore.create({ dataRoot, account });
 *   core.attachWrapper(wrapperExports, { qqVersion, dataDir });
 *   await core.login({ appid: "537237765" });
 *
 * 与手动拼 startNapuketto/quickLogin/initAndStartSession 等价，但把装配状态
 * （ctx）集中管理，协议层直接消费 core.ctx。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type CoreContext, createCoreContext } from "./context.js";
import { kernelError } from "./infra/errors.js";
import { createLogger, type LogLevel } from "./infra/logger.js";
import { type PathOptions, PathWrapper } from "./infra/paths.js";
import { type LoginResult, quickLogin } from "./login/lifecycle.js";
import { QrLoginSession } from "./login/login.js";
import type { NodeIQQNTWrapperSession, WrapperNodeApi } from "./types/wrapper.js";
import { buildLoginConfig } from "./wrapper/wrapper-config.js";
import {
    type BootEnv,
    electronProcessType,
    resolveQqUserDataRoot,
    startNapuketto,
    type WrapperContext,
} from "./wrapper/wrapper-loader.js";

export interface NapukettoCoreOptions {
    /** 数据根 / 账号（透传给 PathWrapper，见 ADR-016）。 */
    paths?: PathOptions;
    /** 日志级别，默认 info。 */
    logLevel?: LogLevel;
    /** 文件日志路径；不传则默认 `logs/napuketto.log`（父目录自动创建）。 */
    logFile?: string;
    /** 是否输出 console，默认 true。 */
    consoleLog?: boolean;
}

/** login 参数。 */
export interface CoreLoginOptions {
    /** appid（登录握手，兜底 537237765）。 */
    appid: string;
    /** session.init 超时（毫秒），默认 15s。 */
    initTimeoutMs?: number;
    /** 指定快速登录账号（缺省遍历历史列表）。 */
    quickUin?: string;
    /** 快速登录失败时回退 QR 登录（二维码写缓存目录），默认 false。 */
    qrFallback?: boolean;
    /** QR 二维码图片保存路径（默认缓存目录 qrcode.png）。 */
    qrCodePath?: string;
}

/**
 * 核心装配器：持有 CoreContext，负责启动/停止编排。
 * 无全局单例（ADR-015 推论）——每账号每进程实例化一份。
 */
export class NapukettoCore {
    /** 装配根（协议层 / apis / cache 的消费入口）。 */
    readonly ctx: CoreContext;

    /** 由 create() 装配，不直接 new。 */
    private constructor(ctx: CoreContext) {
        this.ctx = ctx;
    }

    /**
     * 装配：paths（建目录）→ logger → CoreContext。
     * 不加载 wrapper / 不登录——启动阶段由 attachWrapper + login 完成。
     */
    static create(opts: NapukettoCoreOptions = {}): NapukettoCore {
        const paths = new PathWrapper(opts.paths);
        paths.ensure();
        const logger = createLogger({
            level: opts.logLevel ?? "info",
            console: opts.consoleLog ?? true,
            file: opts.logFile ?? paths.file("logs", "napuketto.log"),
        });
        return new NapukettoCore(createCoreContext({ logger, paths }));
    }

    /**
     * 装配 wrapper：wrapperExports → startNapuketto（engine.init + session 创建），
     * 结果挂到 ctx.wrapper。在 QQ 主进程内调用（boot.cjs 截获 exports 后）。
     * captured：boot.cjs 拦截 `new` 捕获的 QQ 实例（session/loginService，优先使用）。
     */
    attachWrapper(
        wrapperExports: WrapperNodeApi,
        env?: BootEnv,
        captured?: { qqSession?: NodeIQQNTWrapperSession | null; qqLoginService?: unknown },
    ): WrapperContext {
        let wrapper: WrapperContext;
        if (env === undefined) {
            wrapper = startNapuketto({ wrapperExports, ...captured });
        } else {
            wrapper = startNapuketto({ wrapperExports, env, ...captured });
        }
        this.ctx.wrapper = wrapper;
        this.ctx.logger.info({ version: env?.qqVersion }, "wrapper 装配完成（engine + session）");
        return wrapper;
    }

    /**
     * 登录 + session 初始化（wrapper 契约，2026-08-05 实测确认）：
     * loginService.initConfig → 登录（快速/QR）→ **登录成功后** create session + init
     * → 等 onOpentelemetryInit(is_init) 完成信号。成功后填 ctx.login。
     *
     * 关键（实测）：登录前 create()/init 均断言失败（session 未 init / 干扰 QQ）；
     * 登录后 QQ 自己 init 并触发 listener.onOpentelemetryInit——我们只需在登录后
     * create + init 并监听该信号。
     */
    async login(opts: CoreLoginOptions): Promise<LoginResult> {
        const { wrapper } = this.ctx;
        if (wrapper === null) {
            throw kernelError("wrapper 未装配，无法登录", "INVALID_STATE");
        }

        // 1. loginService.initConfig（wrapper 流程：addKernelLoginListener 前）
        const loginService = wrapper.loginService as {
            initConfig?: (config: unknown) => void;
        } | null;
        if (loginService !== null && typeof loginService.initConfig === "function") {
            // worker（utilityProcess）模式下 loginService 是 new 的，commonPath 必须
            // 指向 QQ 真实数据路径（getNTUserDataInfoConfig）才能读到历史账号——
            // cli 的 `.napuketto\default` 读不到（getLoginList 空，P2-1 实测 2026-08-06）。
            let qqDataPath: string | null = null;
            if (electronProcessType() === "utility") {
                qqDataPath = resolveQqUserDataRoot(wrapper.exports);
            }
            const commonPath = qqDataPath ?? this.ctx.paths.accountDir;
            const loginCfg = buildLoginConfig(
                opts.appid,
                wrapper.versionInfo.fullVersion,
                commonPath,
            );
            loginService.initConfig(loginCfg);
            this.ctx.logger.info({ commonPath }, "loginService.initConfig OK");
        } else {
            this.ctx.logger.warn("loginService 不可用，跳过 initConfig");
        }

        // 2. 登录：快速登录（优先）→ QR 回退。登录成功前不碰 session。
        let loginResult: LoginResult;
        try {
            const quickOpts: { uin?: string } = {};
            if (opts.quickUin !== undefined) {
                quickOpts.uin = opts.quickUin;
            }
            loginResult = await quickLogin(wrapper, quickOpts);
            this.ctx.logger.info({ uin: loginResult.uin, uid: loginResult.uid }, "快速登录成功");
        } catch (err) {
            if (opts.qrFallback !== true) {
                throw err;
            }
            loginResult = await this.loginByQr(opts);
        }

        // 3. 登录成功即返回。QQ 登录后重建 session（Proxy 捕获新实例），由 boot.cjs
        // 登录成功后 setSession 替换，再自行等待 session 就绪（waitSessionReady）。
        // 不在 login 内等待——替换发生在 login 返回之后，这里等不到。
        this.ctx.login = loginResult;
        return loginResult;
    }

    /**
     * 替换当前 session（登录后 Proxy 捕获的 QQ 新实例替换自己 create 的无效实例）。
     * 在 QQ 主进程内由 boot.cjs 调用（登录成功后）。
     */
    setSession(session: NodeIQQNTWrapperSession): void {
        if (this.ctx.wrapper === null) {
            throw kernelError("wrapper 未装配，无法设置 session", "INVALID_STATE");
        }
        this.ctx.wrapper.session = session;
    }

    /** QR 登录：QrLoginSession 状态机 + 二维码写缓存目录（无 UI，cli 可打印路径）。 */
    private async loginByQr(opts: CoreLoginOptions): Promise<LoginResult> {
        const { wrapper } = this.ctx;
        if (wrapper === null || wrapper.loginService === null) {
            throw kernelError("wrapper/loginService 不可用，无法 QR 登录", "INVALID_STATE");
        }
        const session = new QrLoginSession(wrapper.loginService);
        const qrPath = opts.qrCodePath ?? this.ctx.paths.file("cache", "qrcode.png");
        session.onQrCode((qr) => {
            this.ctx.logger.warn(`请扫描二维码登录（保存: ${qrPath} | URL: ${qr.qrcodeUrl}）`);
            if (qr.pngBase64 !== "") {
                writeQrCodePng(qrPath, qr.pngBase64);
            }
        });
        session.onStateChange((state) => {
            this.ctx.logger.info({ state }, "QR 登录状态");
        });

        // 启动 QR 登录（注册监听 → connect → getQRCodePicture）
        const startOpts: { quickUin?: string } = {};
        if (opts.quickUin !== undefined) {
            startOpts.quickUin = opts.quickUin;
        }
        session.start(startOpts);

        // 等待登录成功
        await new Promise<void>((resolve, reject) => {
            const offState = session.onStateChange((state) => {
                if (state === "logged_in") {
                    offState();
                    resolve();
                } else if (state === "failed") {
                    offState();
                    reject(kernelError("QR 登录失败", "NOT_LOGIN"));
                }
            });
        });

        const self = session.selfInfo;
        if (self === null) {
            throw kernelError("QR 登录成功但 selfInfo 为空", "INVALID_STATE");
        }
        session.stop();
        return { uin: self.uin, uid: self.uid, nick: self.nick };
    }

    /** 停止：日志收尾（资源清理留给 P2 常驻管理）。 */
    stop(): void {
        this.ctx.logger.info("NapukettoCore 停止");
    }
}

/** 写二维码 png 到磁盘（base64 解码，供 cli/用户扫码）。 */
function writeQrCodePng(filePath: string, pngBase64: string): void {
    try {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, Buffer.from(pngBase64, "base64"));
    } catch {
        // 写失败不阻塞登录（cli 仍可打印 URL）
    }
}
