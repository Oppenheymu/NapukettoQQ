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

// 找进程主窗口就绪（Electron 主进程 UI 起来后可注入）
static bool waitForProcess(HANDLE proc, DWORD pid, DWORD timeoutMs) {
    // 简单方案：等待进程句柄可等待 / 或固定 sleep 后直接注入
    (void)proc;
    (void)pid;
    Sleep(timeoutMs);
    return true;
}

// 注入 hook DLL 到目标进程
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

    WaitForSingleObject(hThread, 10000);
    CloseHandle(hThread);
    VirtualFreeEx(hProc, remoteMem, 0, MEM_RELEASE);
    CloseHandle(hProc);
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
    BOOL ok = CreateProcessA(
        qqPath.c_str(), cmdline.data(), nullptr, nullptr, FALSE,
        CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, nullptr, nullptr, &si, &pi);
    if (!ok) {
        printf("[boot] CreateProcess failed: %lu\n", GetLastError());
        return 1;
    }

    // 用 suspend/resume 确保环境变量已传递
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);

    // 等主进程出现（QQ 可能 fork 或自提权）
    DWORD pid = 0;
    for (int i = 0; i < 30; i++) {
        pid = findQqProcess(qqPath);
        if (pid) break;
        Sleep(500);
    }
    if (!pid) pid = pi.dwProcessId;

    // 等 UI 起来再注入（Electron node 环境就绪）
    waitForProcess(pi.hProcess, pid, 3000);

    // 注入
    injectDll(pid, g_hookDllPath);

    CloseHandle(pi.hProcess);
    return 0;
}
