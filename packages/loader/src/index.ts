/**
 * @napuketto/loader 入口
 *
 * 职责：把 Napuketto 业务代码引导进 QQ 定制版 Electron 主进程。
 *  - locate-qq：定位 QQ.exe + 版本
 *  - launcher：设置环境变量 + 拉起 QQ + 注入 hook DLL
 *  - boot.cjs（runtime/）：QQ 主进程内截获 wrapper.node exports 并启动 kernel
 *
 * 红线：本包是唯一 C++ 组件，但只做注入与引导，绝不裸调 C++ ABI。
 */

export type { LaunchOptions, LaunchResult } from "./launcher.js";
export { defaultStubDir, ENV, launchQqWithLoader, launchSelfHost } from "./launcher.js";
export type { QqInstallInfo } from "./locate-qq.js";
export { locateQqPath, resolveQqInstall } from "./locate-qq.js";
export type { StageResult } from "./stage.js";
export { cleanupStage, stageWrapper } from "./stage.js";
