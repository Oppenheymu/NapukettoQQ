// NapukettoWinBootHook: 注入 QQ 主进程后，通过 node 的 NAPI 注册表注册自研模块，
// 让 Electron 主进程加载 boot 脚本（纯 NAPI，不碰 C++ ABI）。
//
// 原理（2026-08-05 实测）：
//   - wrapper.node 只在 QQ 定制 Electron 里能注册（preload 机制）。
//   - QQ.exe 导出 napi_module_register（GetProcAddress 可拿）。
//   - 我们注册一个自研 napi_module，node 会调用其 nm_register_func 拿到 napi_env，
//     随后在其中执行 boot JS（hook process.dlopen 截获 wrapper.node exports）。
#include <windows.h>
#include <cstdio>
#include <cstring>
#include <string>

// ---- node.h 结构（与 Node 20+ / Electron 兼容的最小子集，自研声明） ----
typedef struct napi_env__ *napi_env;
typedef void *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;

#define NAPI_VERSION 8
#define NAPI_AUTO_LENGTH ((size_t)-1)

// node_api.h 中 nm_register_func 的签名
typedef napi_value (*napi_addon_register_func)(napi_env env, napi_value exports);

typedef struct napi_module {
    int nm_version;
    unsigned int nm_flags;
    const char *nm_filename;
    napi_addon_register_func nm_register_func;
    const char *nm_modname;
    void *nm_priv;
    void *reserved[4];
} napi_module;

// napi_register_module_v1 宏生成的符号（node 用此查找）
extern "C" napi_value napi_register_module_v1(napi_env env, napi_value exports);

// ---- 从 node.exe 动态解析的函数 ----
typedef void (*fn_napi_module_register)(napi_module*);
typedef napi_value (*fn_napi_run_script)(napi_env, const char*, size_t, napi_value*);
typedef napi_value (*fn_napi_create_string_utf8)(napi_env, const char*, size_t, napi_value*);
typedef napi_value (*fn_napi_get_global)(napi_env, napi_value*);
typedef napi_value (*fn_napi_get_named_property)(napi_env, napi_value, const char*, napi_value*);
typedef napi_value (*fn_napi_call_function)(napi_env, napi_value, napi_value, size_t, const napi_value*, napi_value*);
typedef napi_value (*fn_napi_get_cb_info)(napi_env, napi_callback_info, size_t*, napi_value*, napi_value*, void**);

static fn_napi_module_register g_napiModuleRegister = nullptr;

// 延迟解析 napi_* 符号（从主模块/QQ.exe 导出表）
static FARPROC resolveNapi(const char* name) {
    HMODULE hMain = GetModuleHandleA(nullptr); // QQ.exe
    FARPROC p = GetProcAddress(hMain, name);
    if (p) return p;
    // 尝试 QQNT.dll
    HMODULE hQqnt = GetModuleHandleA("QQNT.dll");
    if (hQqnt) {
        p = GetProcAddress(hQqnt, name);
        if (p) return p;
    }
    return nullptr;
}

// boot JS 文件路径（由环境变量注入）
static std::string g_bootJsPath;

// 读取 boot JS 内容
static bool readFileToString(const std::string& path, std::string& out) {
    HANDLE h = CreateFileA(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr,
                           OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    DWORD size = GetFileSize(h, nullptr);
    out.resize(size);
    DWORD read = 0;
    ReadFile(h, out.data(), size, &read, nullptr);
    CloseHandle(h);
    return true;
}

// 解析 napi 函数指针（惰性，第一次调用时）
static void resolveNapiFunctions() {
    if (g_napiModuleRegister) return;
    g_napiModuleRegister = (fn_napi_module_register)resolveNapi("napi_module_register");
    // napi_run_script 等由 node 内部导出（在 node.dll / electron 主模块）
    // 若解析不到，退回到 nm_register_func 里直接调 napi 函数（通过 napi_env）
}

// ---- 注册模块的初始化函数 ----
// 我们的"模块"被 node 加载时，此函数收到 env，然后执行 boot JS。
// 做法：构造一个最小 CJS 模块对象，eval boot.js 内容（CommonJS 上下文）。
static napi_value NapukettoInit(napi_env env, napi_value exports) {
    resolveNapiFunctions();

    std::string js;
    if (!readFileToString(g_bootJsPath, js)) {
        return exports;
    }

    // 用 napi_run_script 直接执行 boot JS（其在 CommonJS 外，但 process 全局可用）
    // 解析函数指针
    auto runScript = (fn_napi_run_script)resolveNapi("napi_run_script");
    if (!runScript) {
        return exports;
    }
    auto createStr = (fn_napi_create_string_utf8)resolveNapi("napi_create_string_utf8");
    if (!createStr) return exports;

    napi_value src;
    createStr(env, js.c_str(), js.size(), &src);
    napi_value result = nullptr;
    runScript(env, js.c_str(), js.size(), &result);

    return exports;
}

// node 期望的 napi_module（nm_register_func 指向上面）
static napi_module g_module = {
    NAPI_VERSION,
    0,
    "napuketto_boot.node",   // nm_filename（任意）
    NapukettoInit,           // nm_register_func
    "napuketto_boot",        // nm_modname
    nullptr,
    {nullptr, nullptr, nullptr, nullptr},
};

// 引导入口：把 g_module 注册进 node 的 NAPI 注册表
static void bootstrap() {
    resolveNapiFunctions();
    if (!g_napiModuleRegister) {
        return; // node 环境未就绪，稍后重试
    }
    g_napiModuleRegister(&g_module);
}

// DllMain：注入后由 LoadLibrary 触发
BOOL WINAPI DllMain(HINSTANCE hinstDLL, DWORD fdwReason, LPVOID) {
    if (fdwReason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hinstDLL);
        // 读环境变量
        char buf[2048] = {0};
        if (GetEnvironmentVariableA("NAPUTO_BOOT_JS", buf, sizeof(buf)) > 0) {
            g_bootJsPath = buf;
        }
        // 立即尝试（若 node 未就绪，napi_module_register 可能还拿不到）
        bootstrap();
        // 轮询重试（在后台线程里）
        CreateThread(nullptr, 0, [](LPVOID) -> DWORD {
            for (int i = 0; i < 20; i++) {
                Sleep(500);
                if (!g_napiModuleRegister) {
                    resolveNapiFunctions();
                }
                if (g_napiModuleRegister) {
                    g_napiModuleRegister(&g_module);
                    break;
                }
            }
            return 0;
        }, nullptr, 0, nullptr);
    }
    return TRUE;
}
