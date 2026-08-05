/**
 * wrapper 交互配置装配（纯函数，无状态）
 *
 * 生成 QQ wrapper 交互所需的三份配置：
 *  - buildEngineConfig  → engine.initWithDeskTopConfig（appid / qua / 版本 / 路径）
 *  - buildLoginConfig   → loginService.initConfig
 *  - buildSessionConfig → session.init（登录成功后调用）
 *
 * 与 lifecycle.ts（流程编排）解耦：本模块只回答「配置长什么样」，不管流程怎么走。
 * 字段参考 NapCat shell 模式 napcat.ts（仅理解机制，自研描述，零复制）。
 */

import { hostname } from "node:os";
import type {
    DeviceInfo,
    EnginInitDesktopConfig,
    WrapperSessionInitConfig,
} from "./types/wrapper.js";
import { PlatformType as PlatformTypeValue, VendorType } from "./types/wrapper.js";

/** 系统信息（NapCat 用 fixed 值即可，真实环境探测后补）。 */
function systemInfo(): { platVer: string; osVersion: string; devType: string } {
    return {
        platVer: "Windows 10.0.22631",
        osVersion: "Windows 10 Pro",
        devType: "Windows",
    };
}

/** Windows 兜底 appid / qua（NapCat appid.json 9.9.31 起缺失时）。 */
function resolveAppidQua(fullVersion: string): { appid: string; qua: string } {
    // 预留：后续可从 appid.json 表扩展
    return {
        appid: "537237765",
        qua: `V1_WIN_NQ_${fullVersion}_${fullVersion.split("-")[1] ?? ""}_GW_B`,
    };
}

/** 生成 engine 桌面配置（NapCat shell 同款字段）。 */
export function buildEngineConfig(
    fullVersion: string,
    dataPathGlobal: string,
): EnginInitDesktopConfig {
    const { osVersion } = systemInfo();
    const { qua } = resolveAppidQua(fullVersion);
    return {
        base_path_prefix: "",
        platform_type: PlatformTypeValue.KWINDOWS,
        app_type: 4,
        app_version: fullVersion,
        os_version: osVersion,
        use_xlog: true,
        qua,
        global_path_config: {
            desktopGlobalPath: dataPathGlobal,
        },
        thumb_config: { maxSide: 324, minSide: 48, longLimit: 6, density: 2 },
    };
}

/** 生成登录初始化配置。 */
export function buildLoginConfig(
    appid: string,
    fullVersion: string,
    commonPath: string,
): Record<string, unknown> {
    const { platVer } = systemInfo();
    return {
        machineId: "",
        appid,
        platVer,
        commonPath,
        clientVer: fullVersion,
        hostName: hostname(),
    };
}

/** buildSessionConfig 参数。 */
export interface SessionConfigOptions {
    appid: string;
    fullVersion: string;
    selfUin: string;
    selfUid: string;
    accountPath: string;
    downloadPath: string;
}

/** 生成 session 初始化配置（登录成功后调用）。 */
export function buildSessionConfig(options: SessionConfigOptions): WrapperSessionInitConfig {
    const { appid, fullVersion, selfUin, selfUid, accountPath, downloadPath } = options;
    const { platVer, osVersion, devType } = systemInfo();
    const deviceInfo: DeviceInfo = {
        guid: "", // TODO: 从 LoginService 获取（NapCat: getMachineId）
        buildVer: fullVersion,
        localId: 2052,
        devName: hostname(),
        devType,
        vendorName: "",
        osVer: osVersion,
        vendorOsName: devType,
        setMute: false,
        vendorType: VendorType.KNOSETONIOS,
    };
    return {
        selfUin,
        selfUid,
        desktopPathConfig: {
            account_path: accountPath,
        },
        clientVer: fullVersion,
        a2: "",
        d2: "",
        d2Key: "",
        machineId: "",
        platform: PlatformTypeValue.KWINDOWS,
        platVer,
        appid,
        rdeliveryConfig: {
            appKey: "",
            systemId: 0,
            appId: "",
            logicEnvironment: "",
            platform: PlatformTypeValue.KWINDOWS,
            language: "",
            sdkVersion: "",
            userId: "",
            appVersion: "",
            osVersion: "",
            bundleId: "",
            serverUrl: "",
            fixedAfterHitKeys: [""],
        },
        defaultFileDownloadPath: downloadPath,
        deviceInfo,
        deviceConfig: '{"appearance":{"isSplitViewMode":true},"msg":{}}',
    };
}
