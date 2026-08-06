/**
 * login.ts：QR 登录流程编排 + 状态机 + selfInfo（ADR-010，2026-08-05）
 *
 * 流程（QQ wrapper 登录契约，自研实现）：
 *  loginService.initConfig（core.login 已做）→ addKernelLoginListener → connect()
 *  → 指定账号：quickLoginWithUin；否则 getQRCodePicture() 触发二维码
 *  → 回调驱动状态机：未登录 → 扫码中 → 已扫码 → 已登录（onQRCodeLoginSucceed）
 *  → 二维码过期（errType=1 errCode=3）→ refresh()
 *
 * 不含 UI 渲染（cli 只做二维码渲染/URL 打印）。
 */
import { kernelError } from "./errors.js";
import type { IKernelLoginListener } from "./types/wrapper.js";
import { createLoginListener } from "./wrapper-adapters.js";

/** 登录状态。 */
export type LoginState = "idle" | "waiting_scan" | "scanned" | "logged_in" | "failed";

/** 二维码数据（png base64 + 解码 url）。 */
export interface QrCodeData {
    pngBase64: string;
    qrcodeUrl: string;
}

/** selfInfo（登录成功后填写）。 */
export interface SelfInfo {
    uin: string;
    uid: string;
    nick: string;
}

/** 快速登录项。 */
export interface LoginListItem {
    uin: string;
    uid?: string;
    nickName?: string;
    isQuickLogin?: boolean;
}

/** loginService 接口（从 WrapperContext.loginService 获取）。 */
interface LoginServiceLike {
    addKernelLoginListener(listener: unknown): number;
    removeKernelLoginListener(listenerId: number): void;
    connect(): void;
    getLoginList(): Promise<{ result: number; LocalLoginInfoList: LoginListItem[] }>;
    quickLoginWithUin(uin: string): Promise<{ result: string; loginErrorInfo: { errMsg: string } }>;
    getQRCodePicture(): boolean;
}

/** 二维码过期错误码（errType=1 errCode=3，实测）。 */
const QR_EXPIRED_ERR_TYPE = 1;
const QR_EXPIRED_ERR_CODE = 3;

/** 二维码过期判定。 */
function isQrCodeExpired(errType: number, errCode: number): boolean {
    return errType === QR_EXPIRED_ERR_TYPE && errCode === QR_EXPIRED_ERR_CODE;
}

/** 二维码 png data URI 前缀剥离正则。 */
const DATA_URI_PREFIX_RE = /^data:image\/\w+;base64,/;

/** QR 登录会话（状态机 + 回调订阅）。 */
export class QrLoginSession {
    private readonly loginService: LoginServiceLike;
    private state: LoginState = "idle";
    private listenerId: number | null = null;
    private self: SelfInfo | null = null;
    private readonly qrCodeHandlers = new Set<(qr: QrCodeData) => void>();
    private readonly stateHandlers = new Set<(state: LoginState) => void>();

    constructor(loginService: unknown) {
        const svc = loginService as LoginServiceLike | null;
        if (svc === null || typeof svc.addKernelLoginListener !== "function") {
            throw kernelError("loginService 无效（缺 addKernelLoginListener）", "INVALID_STATE");
        }
        this.loginService = svc;
    }

    /** 当前状态。 */
    get currentState(): LoginState {
        return this.state;
    }

    /** selfInfo（登录成功后有值）。 */
    get selfInfo(): SelfInfo | null {
        return this.self;
    }

    /** 订阅二维码（png base64 + url）。返回退订函数。 */
    onQrCode(cb: (qr: QrCodeData) => void): () => void {
        this.qrCodeHandlers.add(cb);
        return () => this.qrCodeHandlers.delete(cb);
    }

    /** 订阅状态变化。返回退订函数。 */
    onStateChange(cb: (state: LoginState) => void): () => void {
        this.stateHandlers.add(cb);
        return () => this.stateHandlers.delete(cb);
    }

    /** 开始登录：注册监听 → connect → 快速登录（指定账号）或触发二维码。 */
    start(opts: { quickUin?: string } = {}): void {
        if (this.state !== "idle") {
            return;
        }
        this.listenerId = this.loginService.addKernelLoginListener(this.buildListener());
        this.loginService.connect();
        if (opts.quickUin !== undefined && opts.quickUin !== "") {
            this.loginService.quickLoginWithUin(opts.quickUin).catch(() => {
                // 快速登录失败 → 回退二维码
                this.refresh();
            });
        } else {
            this.refresh();
        }
    }

    /** 刷新二维码（手动 / 过期自动）。 */
    refresh(): void {
        this.setState("waiting_scan");
        this.loginService.getQRCodePicture();
    }

    /** 构建登录监听（普通 JS 对象，NAPI 反射）。 */
    private buildListener(): IKernelLoginListener {
        const listener = createLoginListener();
        listener.onQRCodeGetPicture = ({ pngBase64QrcodeData, qrcodeUrl }) => {
            const realBase64 = pngBase64QrcodeData.replace(DATA_URI_PREFIX_RE, "");
            this.emitQrCode({ pngBase64: realBase64, qrcodeUrl });
        };
        listener.onQRCodeLoginPollingStarted = () => {
            this.setState("waiting_scan");
        };
        listener.onQRCodeSessionUserScaned = () => {
            this.setState("scanned");
        };
        listener.onQRCodeLoginSucceed = (result) => {
            this.self = { uin: result.uin, uid: result.uid, nick: result.nick ?? "" };
            this.setState("logged_in");
        };
        listener.onQRCodeSessionFailed = (errType, errCode) => {
            if (isQrCodeExpired(errType, errCode)) {
                // 二维码过期 → 自动刷新
                this.refresh();
                return;
            }
            this.setState("failed");
        };
        listener.onLoginFailed = () => {
            this.setState("failed");
        };
        return listener;
    }

    /** 停止：注销监听（登录成功后调用，防重复回调）。 */
    stop(): void {
        if (this.listenerId !== null) {
            this.loginService.removeKernelLoginListener(this.listenerId);
            this.listenerId = null;
        }
    }

    private setState(next: LoginState): void {
        this.state = next;
        for (const cb of this.stateHandlers) {
            cb(next);
        }
    }

    private emitQrCode(qr: QrCodeData): void {
        for (const cb of this.qrCodeHandlers) {
            cb(qr);
        }
    }
}
