// 编译 C++ 引导组件：NapukettoBootMain.exe + NapukettoWinBootHook.dll
// 使用 LLVM-MinGW 工具链（g++，clang 22.1.8，x86_64-w64-windows-gnu）
// 用法：node scripts/build-native.mjs
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..");
const NATIVE_DIR = join(PACKAGE_ROOT, "native");
const DIST_DIR = join(PACKAGE_ROOT, "dist", "native");

// 工具链路径（winlibs/LLVM-MinGW 安装位置；也可通过 NAPUTO_MINGW_BIN 环境变量覆盖）
const env = process.env;
const candidateBins = [
    env.NAPUTO_MINGW_BIN,
    join(
        process.env.LOCALAPPDATA ?? "",
        "Microsoft",
        "WinGet",
        "Packages",
        "MartinStorsjo.LLVM-MinGW.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe",
        "llvm-mingw-20260616-ucrt-x86_64",
        "bin",
    ),
    join(
        process.env.LOCALAPPDATA ?? "",
        "Microsoft",
        "WinGet",
        "Packages",
        "BrechtSanders.WinLibs.MCF.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe",
        "mingw64",
        "bin",
    ),
].filter(Boolean);

function findGpp() {
    for (const bin of candidateBins) {
        const p = join(bin, "g++.exe");
        if (existsSync(p)) return p;
    }
    // fallback: PATH
    try {
        return execFileSync("where", ["g++.exe"]).toString().trim().split(/\r?\n/)[0];
    } catch {
        return null;
    }
}

function build() {
    const gpp = findGpp();
    if (!gpp) {
        console.error(
            "[build-native] 未找到 g++.exe。请安装 LLVM-MinGW (winget install MartinStorsjo.LLVM-MinGW.UCRT) 或设置 NAPUTO_MINGW_BIN。",
        );
        process.exit(1);
    }
    mkdirSync(DIST_DIR, { recursive: true });
    console.log(`[build-native] g++ = ${gpp}`);

    // BootMain.exe：拉起 QQ + 注入
    const bootMainSrc = join(NATIVE_DIR, "bootmain.cpp");
    const bootMainOut = join(DIST_DIR, "NapukettoBootMain.exe");
    execFileSync(gpp, [bootMainSrc, "-o", bootMainOut, "-O2", "-s", "-static", "-std=c++17"], {
        stdio: "inherit",
    });
    console.log(`[build-native] OK: ${bootMainOut}`);

    // HookDll.dll：注入后引导 JS
    const hookSrc = join(NATIVE_DIR, "hookdll.cpp");
    const hookOut = join(DIST_DIR, "NapukettoWinBootHook.dll");
    execFileSync(gpp, [hookSrc, "-o", hookOut, "-O2", "-s", "-static", "-std=c++17", "-shared"], {
        stdio: "inherit",
    });
    console.log(`[build-native] OK: ${hookOut}`);

    // boot.cjs：QQ 主进程内截获 wrapper.node exports 并启动 kernel
    const bootSrc = join(PACKAGE_ROOT, "runtime", "boot.cjs");
    const bootOut = join(DIST_DIR, "boot.cjs");
    if (existsSync(bootSrc)) {
        copyFileSync(bootSrc, bootOut);
        console.log(`[build-native] OK: ${bootOut}`);
    } else {
        console.warn(`[build-native] 缺少 boot.cjs: ${bootSrc}`);
    }

    // Vehicle.dll（V2 载具，闭源）：激活 session cpp_impl + 无头
    // 源码在 native-private/（.gitignore 排除，本地/私有仓库）。
    // 公共仓库无此源码 → 跳过编译，loader 以 V1 模式运行。
    const vehicleSrc = join(PACKAGE_ROOT, "native-private", "vehicle.cpp");
    const vehicleOut = join(DIST_DIR, "NapukettoVehicle.dll");
    if (existsSync(vehicleSrc)) {
        execFileSync(gpp, [vehicleSrc, "-o", vehicleOut, "-O2", "-s", "-static", "-std=c++17", "-shared"], {
            stdio: "inherit",
        });
        console.log(`[build-native] OK: ${vehicleOut}`);
    } else {
        console.log("[build-native] 跳过载具（native-private/vehicle.cpp 缺失，闭源组件未随仓库分发）");
    }

    console.log("[build-native] 完成");
}

build();
