"use strict";
/**
 * boot-login.js：登录流程（2026-08-07 阶段 1 从 boot-bootstrap.js 拆分，零语义改动）。
 *
 * 职责：打印可用快速登录账号并选定目标账号（pickLoginAccount）、
 * 快速登录 → QR 回退（doLogin）。由 boot-bootstrap.js require。
 */
const { log } = require("./boot-util.js");

/** 打印可用快速登录账号 + 返回目标账号（启动横幅）。 */
async function pickLoginAccount(kernel, ctx, loginResultRef) {
    try {
        const accounts = await kernel.listLoginAccounts(ctx);
        if (accounts.length > 0) {
            log(`可用于快速登录 of QQ（${accounts.length} 个）：`);
            accounts.forEach((acct, idx) => {
                const nick = acct.nickName || acct.uin;
                const marker = acct.isQuickLogin ? "（默认）" : "";
                log(`${idx + 1}. ${acct.uin} ${nick}${marker}`);
            });
            const target = accounts.find((a) => a.isQuickLogin) ?? accounts[0];
            loginResultRef.targetUin = target.uin;
            log(`正在快速登录 ${target.uin}`);
        } else {
            // boot 阶段尚未 loginService.initConfig（core.login 内部才做），
            // 此处 getLoginList 必空——账号选择交给登录流程（NAPUTO_QUICK_UIN 可指定）。
            log("登录列表暂不可用（boot 阶段未 initConfig），由登录流程自动选择账号");
        }
    } catch (listErr) {
        log(`bootstrap: 获取登录列表失败: ${listErr?.message ?? listErr}`);
    }
}

/**
 * 登录（快速登录 → QR 回退）。
 * @returns LoginResult | null（失败返回 null，不抛出——QR 兜底在内部）
 */
async function doLogin(core, opts) {
    try {
        return await core.login(opts);
    } catch (loginErr) {
        // 快速登录失败 → QR 回退（二维码写缓存目录，boot 日志提示）
        log(`bootstrap: 快速登录失败（${loginErr?.message ?? loginErr}），尝试 QR 登录`);
        try {
            return await core.login({ ...opts, qrFallback: true });
        } catch (qrErr) {
            log(`bootstrap: QR 登录也失败: ${qrErr?.message ?? qrErr}`);
            return null;
        }
    }
}

module.exports = { pickLoginAccount, doLogin };
