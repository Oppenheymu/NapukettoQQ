/**
 * wrapper.node 加载器（P1 核心，ADR-018）
 *
 * 已实测确认（2026-08-05，QQ 9.9.31-49919）：
 * - wrapper.node 是 **C++ ABI 模块**（非 N-API）：导出 INTSessionShell / IGProSessionShell
 *   的 MSVC mangled 工厂符号，不能用 process.dlopen 当 Node 模块用，必须经 koffi 按符号调用。
 * - Node 进程内 SetDefaultDllDirectories 限制了 DLL 搜索（不含 PATH/cwd）→ 必须把
 *   wrapper.node 及其私有依赖（libvips/libglib/libgobject/crypto/ssl/broadcast_ipc/
 *   QQNT.dll/ffmpeg.dll）复制到同一临时目录再加载（已验证可行）。
 * - `INTSessionShell::CreateNTSessionShell(std::string const&)` 返回
 *   `shared_ptr<INTCSessionShellBase>`；std::string 为 MSVC x64 布局（SSO 32 字节）。
 */

import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import koffi from "koffi";
import { kernelError } from "./errors.js";
import type { QQVersionInfo } from "./wrapper-version.js";

/** wrapper.node 私有依赖（与 wrapper.node 同目录或 versions 根目录，9.9.31 实测）。 */
const WRAPPER_DEPS = [
    "libvips-42.dll",
    "libglib-2.0-0.dll",
    "libgobject-2.0-0.dll",
    "crypto.dll",
    "ssl.dll",
    "broadcast_ipc.dll",
];

/** QQNT.dll 依赖（在 versions 根目录，其依赖 ffmpeg.dll 同目录）。 */
const QQNT_DEPS = ["QQNT.dll", "ffmpeg.dll"];

/** MSVC SSO 内联 buffer 长度。 */
const SSO_BUFFER_SIZE = 16;
/** SSO 最大内容长度（<16）。 */
const SSO_MAX_LEN = 15;
/** 对象首字段 vtable 偏移。 */
const VTABLE_OFFSET = 0;

/** MSVC x64 std::string 布局（SSO：16 字节内联 buffer + size + res）。 */
const StdString = koffi.struct("StdString", {
    buf: koffi.array("char", SSO_BUFFER_SIZE),
    size: "uint64",
    res: "uint64",
});

/** shared_ptr 布局：ptr + refcount。 */
const SharedPtr = koffi.struct("SharedPtr", {
    ptr: koffi.pointer("void"),
    ref: koffi.pointer("void"),
});

/** C++ mangled 符号：INTSessionShell::CreateNTSessionShell(std::string const&) -> shared_ptr。 */
const CREATE_SESSION_SYMBOL =
    "?CreateNTSessionShell@INTSessionShell@wrapper@nt@@SA?AV?$shared_ptr@VINTCSessionShellBase@ntc@nt@@@__qq@std@@AEBV?$basic_string@DU?$char_traits@D@__qq@std@@V?$allocator@D@23@@56@@Z";

/** 构造 MSVC SSO 短字符串（<16 字节内联 buffer）。 */
function makeStdString(text: string): { buf: number[]; size: bigint; res: bigint } {
    const bytes = Buffer.from(text, "utf8");
    const buf = new Array<number>(SSO_BUFFER_SIZE).fill(0);
    for (let i = 0; i < Math.min(bytes.length, SSO_MAX_LEN); i += 1) {
        buf[i] = bytes[i] ?? 0;
    }
    return { buf, size: BigInt(bytes.length), res: BigInt(SSO_MAX_LEN) };
}

/** 复制 wrapper.node 与依赖到临时目录（Node DLL 搜索限制的规避方案）。 */
function stageWrapper(versionInfo: QQVersionInfo): { dir: string; wrapperPath: string } {
    const dir = mkdtempSync(join(tmpdir(), "napuketto-wrapper-"));
    const appDir = dirname(versionInfo.wrapperPath);
    // wrapperPath = <install>/versions/<version>/resources/app/wrapper.node
    // QQNT.dll 在 <install>/versions/<version>/（向上 2 层）
    const versionDir = dirname(dirname(appDir));
    const staged: [string, string][] = [
        [versionInfo.wrapperPath, "wrapper.node"],
        ...WRAPPER_DEPS.map((name) => [join(appDir, name), name] as [string, string]),
        ...QQNT_DEPS.map((name) => [join(versionDir, name), name] as [string, string]),
    ];
    for (const [src, name] of staged) {
        if (!existsSync(src)) {
            throw kernelError(`wrapper 依赖缺失: ${src}`, "NOT_FOUND");
        }
        copyFileSync(src, join(dir, name));
    }
    return { dir, wrapperPath: join(dir, "wrapper.node") };
}

/** 会话句柄：session 对象指针（BigInt 地址）+ vtable 地址。 */
export interface NTSessionHandle {
    /** session 对象地址。 */
    ptr: bigint;
    /** vtable 地址（对象首 8 字节）。 */
    vtable: bigint;
}

/** 已加载的 wrapper.node 上下文。 */
export interface WrapperContext {
    /** 版本信息。 */
    versionInfo: QQVersionInfo;
    /** 创建 session 的绑定函数（内部使用）。 */
    createSessionInternal: (config: string) => NTSessionHandle;
    /** 释放临时目录等资源（进程退出前调用）。 */
    dispose: () => void;
}

/**
 * 加载 wrapper.node（复制依赖 → koffi.load → 绑定 session 工厂）。
 * 失败抛 KernelError；成功后调用方持有 WrapperContext，退出前 dispose()。
 */
export function loadWrapperNode(versionInfo: QQVersionInfo): WrapperContext {
    const staged = stageWrapper(versionInfo);
    let lib: ReturnType<typeof koffi.load>;
    try {
        lib = koffi.load(staged.wrapperPath);
    } catch (cause) {
        throw kernelError(`wrapper.node 加载失败: ${staged.wrapperPath}`, "UNKNOWN", { cause });
    }

    let createSessionFn: (name: unknown) => { ptr: unknown; ref: unknown };
    try {
        createSessionFn = lib.func(CREATE_SESSION_SYMBOL, SharedPtr, [koffi.pointer(StdString)]);
    } catch (cause) {
        throw kernelError("CreateNTSessionShell 符号绑定失败", "UNKNOWN", { cause });
    }

    let disposed = false;
    return {
        versionInfo,
        createSessionInternal(config) {
            const result = createSessionFn(makeStdString(config));
            if (result.ptr === null || result.ptr === undefined) {
                throw kernelError("CreateNTSessionShell 返回空 session", "UNKNOWN");
            }
            const ptr = BigInt(result.ptr.toString());
            const vtable = BigInt(koffi.decode(ptr, VTABLE_OFFSET, "uint64").toString());
            return { ptr, vtable };
        },
        dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            try {
                rmSync(staged.dir, { recursive: true, force: true });
            } catch {
                // wrapper.node 仍被进程持有，忽略清理失败
            }
        },
    };
}
