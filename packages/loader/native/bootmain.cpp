// NapukettoBootMain: 拉起 QQ.exe 并注入 hook DLL
// 用法: NapukettoBootMain.exe <QQ.exe路径> <hook.dll路径> <boot.js路径> [kernel入口] [配置目录]
//
// 注意：本组件只做两件事——启动进程 + DLL 注入，不接触任何 C++ ABI。
#include <windows.h>
#include <tlhelp32.h>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

static std::string g_hookDllPath;
static std::string g_bootJsPath;
static std::string g_kernelEntry;
static std::string g_cfgDir;

// 读取环境变量（launcher.ts 设置）
static std::string getEnv(const char* name) {
    char buf[1024] = {0};
    DWORD n = GetEnvironmentVariableA(name, buf, sizeof(buf));
    return (n > 0 && n < sizeof(buf)) ? std::string(buf) : std::string();
}

// 检查目标进程是否存活（GetExitCodeProcess == STILL_ACTIVE）
static bool isProcessAlive(DWORD pid) {
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!h) return false;
    DWORD code = 0;
    BOOL ok = GetExitCodeProcess(h, &code);
    CloseHandle(h);
    return ok && code == STILL_ACTIVE;
}

// 注入 DLL 到目标进程，并校验 LoadLibraryA 真实返回（HMODULE != 0）。
// 关键（2026-08-06 修复）：CreateRemoteThread 成功 ≠ DLL 已加载。进程早期
// （loader lock 被初始线程持有）LoadLibraryA 可能阻塞/失败——之前不查返回值，
// bootmain 误报注入成功 → hookdll 未进 → boot.cjs 未执行（交接 §11 遗留 1）。
static bool injectDll(DWORD pid, const std::string& dllPath) {
    HANDLE hProc = OpenProcess(PROCESS_ALL_ACCESS, FALSE, pid);
    if (!hProc) {
        printf("[boot] OpenProcess failed: %lu\n", GetLastError());
        return false;
    }

    // 远程分配路径字符串
    size_t len = dllPath.size() + 1;
    void* remoteMem = VirtualAllocEx(hProc, nullptr, len, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (!remoteMem) {
        printf("[boot] VirtualAllocEx failed: %lu\n", GetLastError());
        CloseHandle(hProc);
        return false;
    }
    WriteProcessMemory(hProc, remoteMem, dllPath.c_str(), len, nullptr);

    // 远程线程加载 DLL
    HMODULE k32 = GetModuleHandleA("kernel32.dll");
    FARPROC loadLib = GetProcAddress(k32, "LoadLibraryA");
    HANDLE hThread = CreateRemoteThread(hProc, nullptr, 0, (LPTHREAD_START_ROUTINE)loadLib, remoteMem, 0, nullptr);
    if (!hThread) {
        printf("[boot] CreateRemoteThread failed: %lu\n", GetLastError());
        VirtualFreeEx(hProc, remoteMem, 0, MEM_RELEASE);
        CloseHandle(hProc);
        return false;
    }

    // 等 LoadLibrary 线程结束，GetExitCodeThread 取返回值（HMODULE）
    bool loaded = false;
    DWORD waitRet = WaitForSingleObject(hThread, 10000);
    DWORD exitCode = 0;
    if (waitRet == WAIT_OBJECT_0 && GetExitCodeThread(hThread, &exitCode)) {
        loaded = (exitCode != 0);
        if (!loaded) {
            printf("[boot] LoadLibraryA in remote returned NULL（进程未就绪或加载失败），重试注入\n");
        }
    } else {
        printf("[boot] remote thread wait failed: waitRet=%lu err=%lu\n", waitRet, GetLastError());
    }
    CloseHandle(hThread);
    VirtualFreeEx(hProc, remoteMem, 0, MEM_RELEASE);
    CloseHandle(hProc);
    if (!loaded) return false;
    printf("[boot] injected: %s\n", dllPath.c_str());
    return true;
}

// 通过快照找 QQ 主进程（CreateProcess 后 app 可能 fork）
static DWORD findQqProcess(const std::string& qqPath) {
    std::string exeName = qqPath;
    size_t slash = exeName.find_last_of("\\/");
    if (slash != std::string::npos) exeName = exeName.substr(slash + 1);
    if (exeName.empty()) exeName = "QQ.exe";

    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return 0;

    PROCESSENTRY32W pe;
    pe.dwSize = sizeof(pe);
    DWORD best = 0;
    if (Process32FirstW(snap, &pe)) {
        do {
            // 比较时转宽字符（-municode 下 szExeFile 是 WCHAR）
            std::wstring wexe(pe.szExeFile);
            std::string exe(wexe.begin(), wexe.end());
            if (exe.size() > 0 && _stricmp(exe.c_str(), exeName.c_str()) == 0) {
                // 取 PID 最大的（主进程）
                if (pe.th32ProcessID > best) best = pe.th32ProcessID;
            }
        } while (Process32NextW(snap, &pe));
    }
    CloseHandle(snap);
    return best;
}

int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR, int) {
    // 读环境变量（由 launcher.ts 设置）
    g_hookDllPath = getEnv("NAPUTO_HOOK_DLL");
    g_bootJsPath = getEnv("NAPUTO_BOOT_JS");
    g_kernelEntry = getEnv("NAPUTO_KERNEL_ENTRY");
    g_cfgDir = getEnv("NAPUTO_CFG_DIR");
    std::string qqPath = getEnv("NAPUTO_QQ_PATH");

    if (qqPath.empty()) {
        printf("[boot] NAPUTO_QQ_PATH not set\n");
        return 1;
    }
    if (g_hookDllPath.empty()) {
        printf("[boot] NAPUTO_HOOK_DLL not set\n");
        return 1;
    }

    printf("[boot] QQ=%s\n", qqPath.c_str());
    printf("[boot] hook=%s\n", g_hookDllPath.c_str());
    printf("[boot] bootjs=%s\n", g_bootJsPath.c_str());

    // 启动 QQ
    STARTUPINFOA si = {sizeof(si)};
    PROCESS_INFORMATION pi = {};
    std::string cmdline = "\"" + qqPath + "\"";
    // 实测发现（2026-08-05）：CREATE_SUSPENDED 挂起注入会让 QQ 卡死（1 进程无窗口，
    // CPU≈0，疑似触发反注入/完整性检测）。改回正常启动 + 找到主进程后立即注入。
    BOOL ok = CreateProcessA(
        qqPath.c_str(), cmdline.data(), nullptr, nullptr, FALSE,
        CREATE_UNICODE_ENVIRONMENT, nullptr, nullptr, &si, &pi);
    if (!ok) {
        printf("[boot] CreateProcess failed: %lu\n", GetLastError());
        return 1;
    }
    CloseHandle(pi.hThread);

    // 注入目标：优先 CreateProcess 的进程（QQ 主进程）。若注入失败（进程刚退出/
    // 权限不足等），再按快照找存活实例兜底——避免注入用户已打开的旧 QQ 实例
    // （QQ 单实例：新启动进程会转发参数后退场，findQqProcess 取 PID 最大会命中旧实例）。
    DWORD pid = pi.dwProcessId;

    // ⚠️ 注入时序修复（2026-08-06，交接 §11 遗留 1）：
    //   之前 CreateProcess 后立即注入 → 进程 loader 早期 LoadLibraryA 阻塞/失败，
    //   且 injectDll 不查返回值 → 误报成功 → hookdll 未进 → boot.cjs 未执行。
    //   现在：① WaitForInputIdle 等主进程 GUI 线程初始化完成（≈Electron 启动早期，
    //   早于 wrapper.node preload 注册——hookdll 必须在 preload 前注入才能触发 boot）
    //         ② 注入失败则等待重试（每次重试进程更成熟）。
    WaitForInputIdle(pi.hProcess, 15000);

    // ① hookdll（引导 boot JS）：重试式注入，最长 ~15s
    bool hooked = false;
    for (int i = 0; i < 50 && !hooked; i++) {
        if (!isProcessAlive(pid)) break; // 进程已退出（单实例转发场景）
        hooked = injectDll(pid, g_hookDllPath);
        if (!hooked) Sleep(300);
    }
    printf("[boot] hookdll 注入结果: %s (pid=%lu)\n", hooked ? "成功" : "失败", pid);

    // ② 兜底：hookdll 未注入 → 快照重试（进程可能 fork/已退出，重新定位存活实例）
    if (!hooked) {
        pid = 0;
        for (int i = 0; i < 30; i++) {
            pid = findQqProcess(qqPath);
            if (pid && injectDll(pid, g_hookDllPath)) {
                hooked = true;
                break;
            }
            Sleep(500);
        }
        if (hooked) {
            printf("[boot] 快照兜底注入成功 (pid=%lu)\n", pid);
        }
    }
    if (pid == 0) pid = pi.dwProcessId;

    // ③ V2 载具 DLL（NapukettoVehicle.dll）：激活 session cpp_impl + 无头。
    // 注入顺序：先 hookdll（引导 boot JS），再 vehicle（激活 session）。
    // 载具 DLL 路径经环境变量 NAPUTO_VEHICLE_DLL 传入（launcher.ts 设置），
    // 若未设置（未启用 V2）则跳过，保持 V1 行为兼容。
    std::string vehicleDll = getEnv("NAPUTO_VEHICLE_DLL");
    if (!vehicleDll.empty()) {
        printf("[boot] injecting vehicle: %s\n", vehicleDll.c_str());
        bool injected = false;
        for (int i = 0; i < 20 && !injected; i++) {
            if (!isProcessAlive(pid)) break;
            injected = injectDll(pid, vehicleDll);
            if (!injected) Sleep(300);
        }
        printf("[boot] vehicle 注入结果: %s\n", injected ? "成功" : "失败");
    } else {
        printf("[boot] NAPUTO_VEHICLE_DLL 未设置，跳过载具注入（V1 模式）\n");
    }

    // 保持存活直到 QQ 进程退出：cli（boot.ts child.on("exit")）观察的是本进程
    // 生命周期，必须等到 QQ 真正退出才能结束——原实现注入后立即 return 0，
    // 导致 cli 误报「QQ 进程退出 code=0」并提前退出（2026-08-05 定位）。
    printf("[boot] waiting for QQ exit (pid=%lu)...\n", pi.dwProcessId);
    WaitForSingleObject(pi.hProcess, INFINITE);
    DWORD exitCode = 0;
    if (!GetExitCodeProcess(pi.hProcess, &exitCode)) {
        exitCode = 1;
    }
    printf("[boot] QQ exited, code=%lu\n", exitCode);
    CloseHandle(pi.hProcess);
    return (int)exitCode;
}
