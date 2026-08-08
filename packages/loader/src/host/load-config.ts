/**
 * 协议配置段读取（从 protocols.ts 拆分，2026-08-08 FTA 优化）
 *
 * 全局 TOML 配置（<项目根>/napuketto.toml，2026-08-07 用户拍板：配置文件放项目根）：
 * 读 [onebot11] / [satori] 段，装配时 zod 校验后作 seed。路径优先级：NAPKETTO_CONFIG
 * （launcher 注入）> 装配链自身探测（kernel.resolveConfigPath）> NAPUTO_CFG_DIR 兜底
 * （旧行为兼容）。（ConfigBase seed 模式：load() 直接用内存值，不再读写独立协议文件）
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "./env.js";
import type { KernelLike } from "./types.js";
import { errMsg, log } from "./util.js";

/** 协议配置段（TOML [onebot11] / [satori]，宽松对象，装配时 zod 校验）。 */
export interface ProtocolSections {
    cfgFile: string;
    ob11Section: Record<string, unknown>;
    satoriSection: Record<string, unknown>;
}

/** 读取全局 TOML 的协议段（读取失败用默认空段，不阻塞装配）。 */
export function loadProtocolSections(kernel: KernelLike): ProtocolSections {
    const cfgFile = env.NAPKETTO_CONFIG || join(env.NAPUTO_CFG_DIR || ".", "napuketto.toml");
    let ob11Section: Record<string, unknown> = {};
    let satoriSection: Record<string, unknown> = {};
    try {
        const raw = readFileSync(cfgFile, "utf8");
        const parsed = kernel.parseToml(raw);
        const ob11 = parsed["onebot11"];
        const satori = parsed["satori"];
        if (ob11 !== undefined && ob11 !== null && typeof ob11 === "object") {
            ob11Section = ob11 as Record<string, unknown>;
        }
        if (satori !== undefined && satori !== null && typeof satori === "object") {
            satoriSection = satori as Record<string, unknown>;
        }
    } catch (e) {
        log(`bootstrap: 全局配置读取失败（用默认 ob11/satori 配置）: ${errMsg(e)}`);
    }
    return { cfgFile, ob11Section, satoriSection };
}
