// biome-ignore-all lint/suspicious/noConsole: E2E 验证脚本（结论输出用 console）
/**
 * e2e-ob11-client.mjs：OneBot 11 外部链路端到端验证脚本（2026-09-08 T10 临时脚手架）。
 *
 * 用途：连接本机 OB11 WS 服务器（napuketto.toml wsServers 配置），验证
 * ① 事件上报到达（lifecycle/heartbeat meta 事件）② 动作调用往返（get_login_info）。
 * 用法：node scripts/e2e-ob11-client.mjs [wsUrl] [token]
 * （缺省 ws://127.0.0.1:3001 test；退出码 0 = 验证通过）
 */
const url = process.argv[2] ?? "ws://127.0.0.1:3001";
const token = process.argv[3] ?? "test";

const ws = new WebSocket(`${url}?access_token=${token}`);
const received = [];
let actionResult = null;
let resolved = false;

const timer = setTimeout(() => {
    finish(new Error("15 秒内未完成验证（事件或动作未达）"));
}, 15_000);

function finish(err) {
    if (resolved) {
        return;
    }
    resolved = true;
    clearTimeout(timer);
    try {
        ws.close();
    } catch {
        // ignore
    }
    if (err !== undefined) {
        console.error(`E2E FAIL: ${err.message}`);
        process.exit(1);
    }
    const meta = received.filter((e) => e.post_type === "meta_event").length;
    console.log(`E2E OK: 收到事件 ${received.length} 条（meta ${meta} 条）`);
    console.log(`get_login_info → status=${actionResult?.status} retcode=${actionResult?.retcode}`);
    process.exit(0);
}

ws.addEventListener("open", () => {
    console.log("WS 已连接，发送 get_login_info");
    ws.send(JSON.stringify({ action: "get_login_info", echo: "e2e-1" }));
});

ws.addEventListener("message", (ev) => {
    let data;
    try {
        data = JSON.parse(String(ev.data));
    } catch {
        return;
    }
    if (data.echo === "e2e-1") {
        actionResult = data;
        // 动作往返成功 + 至少收到一条事件（lifecycle enable 在连接前已广播，
        // heartbeat 3s 一条）→ 等第一条事件后收尾
        if (received.length > 0) {
            finish();
        }
        return;
    }
    if (data.post_type !== undefined) {
        received.push(data);
        if (actionResult !== null) {
            finish();
        }
    }
});

ws.addEventListener("error", (ev) => {
    finish(new Error(`WS 错误: ${String(ev.message ?? ev.type)}`));
});

ws.addEventListener("close", (ev) => {
    if (!resolved) {
        finish(new Error(`WS 提前关闭 code=${ev.code}`));
    }
});
