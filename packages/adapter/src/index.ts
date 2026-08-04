/**
 * @napuketto/adapter 入口
 * 协议适配器容器：core 框架 + onebot11 / onebot12 / satori。
 * 根入口保持轻量（ADR-014）：只导出公共类型，不聚合三个协议；协议面走子路径（./core、./onebot11 等）。
 */

/** 协议标识（多协议共存的装配 key）。 */
export type ProtocolId = "onebot11" | "onebot12" | "satori";
