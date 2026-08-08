/**
 * 等待/延迟工具（login 模块共享，2026-08-08 克隆合并）
 */

/** 等待条件满足（轮询，带超时）。 */
export function waitFor(
    predicate: () => boolean,
    timeoutMs: number,
    intervalMs = 500,
): Promise<boolean> {
    return new Promise((resolve) => {
        const started = Date.now();
        const tick = (): void => {
            if (predicate()) {
                resolve(true);
                return;
            }
            if (Date.now() - started > timeoutMs) {
                resolve(false);
                return;
            }
            setTimeout(tick, intervalMs);
        };
        tick();
    });
}

/** 短延迟。 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
