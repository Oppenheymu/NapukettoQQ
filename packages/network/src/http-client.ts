/**
 * 正向 HTTP 客户端（事件上报）
 *
 * 协议层把事件 `send` 出去即触发一次 POST 上报（fire-and-forget）。
 * 失败（网络错误 / 非 2xx / 超时）经 `onError` 回调交给协议层。
 */
import type { HttpClientOptions, TransportAdapter } from "./types.js";

export class HttpClient implements TransportAdapter {
    private readonly opts: HttpClientOptions;

    constructor(opts: HttpClientOptions) {
        this.opts = opts;
    }

    send<T>(payload: T): void {
        const { url, headers, timeoutMs, onError } = this.opts;
        this.post(url, payload, headers, timeoutMs).catch((err: unknown) => onError?.(err));
    }

    /** 正向上报无连接管理。 */
    open(): void | Promise<void> {
        // no-op
    }

    close(): void | Promise<void> {
        // no-op
    }

    private async post(
        url: string,
        payload: unknown,
        headers: Record<string, string> | undefined,
        timeoutMs: number | undefined,
    ): Promise<void> {
        const controller = new AbortController();
        let timer: NodeJS.Timeout | undefined;
        if (timeoutMs !== undefined) {
            timer = setTimeout(() => controller.abort(), timeoutMs);
        }
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "content-type": "application/json", ...headers },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            if (!res.ok) {
                throw new Error(`HTTP 上报失败: ${res.status} ${res.statusText}`);
            }
        } finally {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
        }
    }
}
