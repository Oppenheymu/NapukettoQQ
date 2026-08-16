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
 * appid 唯一来源是 major.node 动态解析（每版本不同）；解析失败显式抛 KernelError，
 * 不再静默回退过期 appid（2026-08 硬编码审计：537237765 是 9.9.31 的 appid，该版本
 * 登录服务已被腾讯下线，静默用它会导致扫码「请下载最新版」且极难排查）。
 */

import { existsSync, readFileSync } from "node:fs";
import { hostname, type as osType, version as osVersionString, platform, release } from "node:os";
import { kernelError } from "../infra/index.js";
import type {
    DeviceInfo,
    EnginInitDesktopConfig,
    WrapperSessionInitConfig,
} from "../types/index.js";
import { PlatformType as PlatformTypeValue, VendorType } from "../types/index.js";

/** app_type=4：桌面端应用类型（engine.initWithDeskTopConfig 契约；移动端为其它值）。 */
const APP_TYPE_DESKTOP = 4;

/**
 * 缩略图生成参数（thumb_config，engine 契约）：
 * maxSide 最长边像素上限 / minSide 最短边像素下限 / longLimit 长图最长短边比例上限 /
 * density 像素密度倍数。
 */
const THUMB_CONFIG = {
    maxSide: 324,
    minSide: 48,
    longLimit: 6,
    density: 2,
} as const;

/**
 * session.init 的 deviceConfig（wrapper 契约，JSON 字符串字面量）：
 * appearance.isSplitViewMode 分屏模式开关，msg 空对象为占位。自建宿主无 UI，保持最小可用。
 */
const DEVICE_CONFIG_JSON = '{"appearance":{"isSplitViewMode":true},"msg":{}}';

/** localId=2052：zh-CN（简体中文）locale 码（Windows LCID，deviceInfo.localId 契约）。 */
const ZH_CN_LOCALE_ID = 2052;

/** 平台名映射：os.platform() → wrapper devType 契约值（不写死具体构建号）。 */
const DEV_TYPE_BY_PLATFORM: Record<string, string> = {
    win32: "Windows",
    darwin: "Mac",
    linux: "Linux",
    android: "Android",
    freebsd: "FreeBSD",
    openbsd: "OpenBSD",
    sunos: "SunOS",
    aix: "AIX",
};

/**
 * 系统信息运行时探测（wrapper 契约：platVer / osVersion / devType）。
 * 旧实现写死 "Windows 10.0.22631"/"Windows 10 Pro"——换机即失真（2026-08 硬编码审计整改）。
 * 探测失败时给通用值兜底，但不写死具体 Windows 构建号。
 */
function systemInfo(): { platVer: string; osVersion: string; devType: string } {
    let devType = "Unknown";
    let platVer = "Unknown";
    let osVersion = "Unknown";
    try {
        devType = DEV_TYPE_BY_PLATFORM[platform()] ?? platform();
        // platVer 契约形如 "Windows 10.0.22631" = "<平台名> <内核版本号>"。
        platVer = `${devType} ${release()}`;
        // osVersion 优先 os.version()（Windows 返回 "Windows 11 Pro" 等），空则用 os.type()。
        osVersion = osVersionString() || osType();
    } catch {
        // 探测失败：保留通用兜底值。
    }
    return { platVer, osVersion, devType };
}

/** 纯数字串（major.node 提取的 appid 判定）。 */
const DIGITS_ONLY_RE = /^\d+$/;

/**
 * 从 major.node 提取 appid（NapCat parseAppidFromMajorV2 的自研等价实现）。
 * major.node 含 `QQAppId/` 标记后跟数字（腾讯工具链产物，实测确认）。
 * 返回 null 表示解析失败（调用方应显式报错，不再回退硬编码 appid）。
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

/**
 * 解析 appid / qua（自研，参考 NapCat QQBasicInfoWrapper 思路但独立实现）：
 * appid 唯一来源 = major.node 提取（实测 9.9.33-51802 = 537376818）。
 * majorPath 缺省或解析失败时抛 KernelError——不再静默回退过期 appid。
 * majorPath 传 wrapper.node 同目录 major.node。
 */
export function resolveAppidQua(
    fullVersion: string,
    majorPath?: string,
): { appid: string; qua: string } {
    const appid = majorPath !== undefined ? parseAppidFromMajor(majorPath) : null;
    if (appid === null) {
        throw kernelError(
            "无法从 major.node 解析 appid，请确认 wrapper.node/major.node 完整，或更新 qq-releases.json",
            "INVALID_STATE",
        );
    }
    return {
        appid,
        qua: `V1_WIN_NQ_${fullVersion}_${fullVersion.split("-")[1] ?? ""}_GW_B`,
    };
}

/** 生成 engine 桌面配置（wrapper 契约字段）。majorPath 可选（缺失/解析失败会抛错）。 */
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
        app_type: APP_TYPE_DESKTOP,
        app_version: fullVersion,
        os_version: osVersion,
        use_xlog: true,
        qua,
        global_path_config: {
            desktopGlobalPath: dataPathGlobal,
        },
        thumb_config: THUMB_CONFIG,
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
        localId: ZH_CN_LOCALE_ID,
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
        deviceConfig: DEVICE_CONFIG_JSON,
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
