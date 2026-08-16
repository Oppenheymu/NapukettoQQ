/**
 * wrapper 交互配置装配（纯函数，无状态）
 *
 * 生成 QQ wrapper 交互所需的三份配置：
 *  - buildEngineConfig  → engine.initWithDeskTopConfig（appid / qua / 版本 / 路径）
 *  - buildLoginConfig   → loginService.initConfig
 *  - buildSessionConfig → session.init（登录成功后调用）
 *
 * 与 lifecycle.ts（流程编排）解耦：本模块只回答「配置长什么样」，不管流程怎么走。
 * 字段为 wrapper.node 外部契约（appid/qua/版本），运行时实测确认，自研描述。
 */

import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import type {
    DeviceInfo,
    EnginInitDesktopConfig,
    WrapperSessionInitConfig,
} from "../types/index.js";
import { PlatformType as PlatformTypeValue, VendorType } from "../types/index.js";

/** 系统信息（先用 fixed 值，真实环境探测后补）。 */
function systemInfo(): { platVer: string; osVersion: string; devType: string } {
    return {
        platVer: "Windows 10.0.22631",
        osVersion: "Windows 10 Pro",
        devType: "Windows",
    };
}

/** 纯数字串（major.node 提取的 appid 判定）。 */
const DIGITS_ONLY_RE = /^\d+$/;

/**
 * 从 major.node 提取 appid（NapCat parseAppidFromMajorV2 的自研等价实现）。
 * major.node 含 `QQAppId/` 标记后跟数字（腾讯工具链产物，实测确认）。
 * 返回 null 表示解析失败（调用方回退硬编码表）。
 */
export function parseAppidFromMajor(majorPath: string): string | null {
    if (!existsSync(majorPath)) {
        return null;
    }
    let buf: Buffer;
    try {
        buf = readFileSync(majorPath);
    } catch {
        return null;
    }
    return scanAppidMarkers(buf);
}

/** 扫描 buf 中所有 QQAppId/ 标记，返回第一个纯数字串（无则 null）。 */
function scanAppidMarkers(buf: Buffer): string | null {
    const marker = Buffer.from("QQAppId/", "utf-8");
    let pos = 0;
    while (pos < buf.length) {
        const idx = buf.indexOf(marker, pos);
        if (idx === -1) {
            return null;
        }
        const str = readMarkerValue(buf, idx + marker.length);
        if (DIGITS_ONLY_RE.test(str)) {
            return str;
        }
        pos = idx + marker.length + str.length + 1;
    }
    return null;
}

/** 读取标记后的 C 字符串（到首个 0 字节为止）。 */
function readMarkerValue(buf: Buffer, start: number): string {
    let end = start;
    while (end < buf.length && buf[end] !== 0) {
        end += 1;
    }
    return buf.subarray(start, end).toString("utf-8");
}

/** Windows 兜底 appid / qua（major.node 解析失败时）。 */
function fallbackAppidQua(fullVersion: string): { appid: string; qua: string } {
    return {
        appid: "537237765",
        qua: `V1_WIN_NQ_${fullVersion}_${fullVersion.split("-")[1] ?? ""}_GW_B`,
    };
}

/**
 * 解析 appid / qua（自研，参考 NapCat QQBasicInfoWrapper 思路但独立实现）：
 *  1. 优先从 major.node 提取 appid（实测 9.9.33-51802 = 537376818）
 *  2. 回退硬编码表（旧版 537237765）
 * majorPath 传 wrapper.node 同目录 major.node；不传则跳过 major 解析。
 */
export function resolveAppidQua(
    fullVersion: string,
    majorPath?: string,
): { appid: string; qua: string } {
    if (majorPath !== undefined) {
        const appid = parseAppidFromMajor(majorPath);
        if (appid !== null) {
            return {
                appid,
                qua: `V1_WIN_NQ_${fullVersion}_${fullVersion.split("-")[1] ?? ""}_GW_B`,
            };
        }
    }
    return fallbackAppidQua(fullVersion);
}

/** 生成 engine 桌面配置（wrapper 契约字段）。majorPath 可选（解析 appid/qua）。 */
export function buildEngineConfig(
    fullVersion: string,
    dataPathGlobal: string,
    majorPath?: string,
): EnginInitDesktopConfig {
    const { osVersion } = systemInfo();
    const { qua } = resolveAppidQua(fullVersion, majorPath);
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

/** 生成登录初始化配置（externalVersion: false 与 NapCat 同款，扫码兼容关键）。 */
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
        externalVersion: false,
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
    /** 设备指纹 guid（来自 loginService.getMachineGuid()；缺省空串）。 */
    machineGuid?: string;
}

/** 生成 session 初始化配置（登录成功后调用）。 */
export function buildSessionConfig(options: SessionConfigOptions): WrapperSessionInitConfig {
    const { appid, fullVersion, selfUin, selfUid, accountPath, downloadPath, machineGuid } =
        options;
    const { platVer, osVersion, devType } = systemInfo();
    const deviceInfo: DeviceInfo = {
        // 设备指纹 guid：loginService.getMachineGuid()（wrapper 探测确认，无 getMachineId 方法）。
        guid: machineGuid ?? "",
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

/**
 * 读取设备指纹 guid（wrapper.node 字符串分析实证，2026-08-12）：
 * NodeIKernelLoginService::getMachineGuid（0 参，返回机器 GUID 字符串）。
 * 无 getMachineId 方法——TODO 里的方法名不存在，等价方法是 getMachineGuid。
 * 失败（无该方法 / 调用抛错 / 返回值非字符串）兜底空串。
 */
export function readMachineGuid(loginService: unknown): string {
    try {
        const fn = (loginService as Record<string, unknown> | null | undefined)?.["getMachineGuid"];
        if (typeof fn !== "function") {
            return "";
        }
        const value: unknown = fn.call(loginService);
        return typeof value === "string" ? value : "";
    } catch {
        return "";
    }
}
