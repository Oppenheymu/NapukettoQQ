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

import { type CoreContext, createCoreContext } from "./context.js";
import { kernelError } from "./errors.js";
import type { LoginResult } from "./lifecycle.js";
import { initAndStartSession, quickLogin } from "./lifecycle.js";
import { createLogger, type LogLevel } from "./logger.js";
import { type PathOptions, PathWrapper } from "./paths.js";
import type { WrapperNodeApi } from "./types/wrapper.js";
import { createSessionListener } from "./wrapper-adapters.js";
import { buildLoginConfig, buildSessionConfig } from "./wrapper-config.js";
import type { BootEnv, WrapperContext } from "./wrapper-loader.js";
import { startNapuketto } from "./wrapper-loader.js";

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
    /** appid（登录握手，NapCat appid.json 兜底 537237765）。 */
    appid: string;
    /** session.init 超时（毫秒），默认 15s。 */
    initTimeoutMs?: number;
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
     */
    attachWrapper(wrapperExports: WrapperNodeApi, env?: BootEnv): WrapperContext {
        let wrapper: WrapperContext;
        if (env === undefined) {
            wrapper = startNapuketto({ wrapperExports });
        } else {
            wrapper = startNapuketto({ wrapperExports, env });
        }
        this.ctx.wrapper = wrapper;
        this.ctx.logger.info({ version: env?.qqVersion }, "wrapper 装配完成（engine + session）");
        return wrapper;
    }

    /**
     * 快速登录 + session 初始化（NapCat shell 流程）：
     * loginService.initConfig → quickLogin → session.init(config, adapters, listener) → startNT(0)。
     * 成功后填 ctx.login。
     */
    async login(opts: CoreLoginOptions): Promise<LoginResult> {
        const { wrapper } = this.ctx;
        if (wrapper === null) {
            throw kernelError("wrapper 未装配，无法登录", "INVALID_STATE");
        }

        // 1. loginService.initConfig（NapCat shell 流程：addKernelLoginListener 前）
        const loginService = wrapper.loginService as {
            initConfig?: (config: unknown) => void;
        } | null;
        if (loginService !== null && typeof loginService.initConfig === "function") {
            const loginCfg = buildLoginConfig(
                opts.appid,
                wrapper.versionInfo.fullVersion,
                this.ctx.paths.accountDir,
            );
            loginService.initConfig(loginCfg);
            this.ctx.logger.info("loginService.initConfig OK");
        } else {
            this.ctx.logger.warn("loginService 不可用，跳过 initConfig");
        }

        // 2. 快速登录
        const loginResult = await quickLogin(wrapper, {});
        this.ctx.logger.info({ uin: loginResult.uin, uid: loginResult.uid }, "快速登录成功");

        // 3. session.init + startNT（等 init 完成信号，lifecycle 封装）
        const sessionConfig = buildSessionConfig({
            appid: opts.appid,
            fullVersion: wrapper.versionInfo.fullVersion,
            selfUin: loginResult.uin,
            selfUid: loginResult.uid,
            accountPath: this.ctx.paths.accountDir,
            downloadPath: this.ctx.paths.file("cache", "download"),
        });
        const listener = createSessionListener();
        let initOpts: { timeoutMs?: number } = {};
        if (opts.initTimeoutMs !== undefined) {
            initOpts = { timeoutMs: opts.initTimeoutMs };
        }
        await initAndStartSession(wrapper, sessionConfig, listener, initOpts);
        this.ctx.logger.info("session init + startNT OK");

        this.ctx.login = loginResult;
        return loginResult;
    }

    /** 停止：日志收尾（资源清理留给 P2 常驻管理）。 */
    stop(): void {
        this.ctx.logger.info("NapukettoCore 停止");
    }
}
