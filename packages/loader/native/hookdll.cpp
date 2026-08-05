// NapukettoWinBootHook: 注入 QQ 主进程后，通过 node 的 NAPI 注册表注册自研模块，
// 让 Electron 主进程加载 boot 脚本（纯 NAPI，不碰 C++ ABI）。
//
// 原理（2026-08-05 实测）：
//   - wrapper.node 只在 QQ 定制 Electron 里能注册（preload 机制）。
//   - QQ.exe 导出全套 napi_* 符号（静态导出表探测确认）。
//   - 触发机制（v7，IAT hook 最终方案）：
//       a) QQ 9.9.31 JS 全量字节码化，preload 不走 napi_run_script。
//       b) QQ.exe 的 napi_* 导出是 **delay-load stub**：
//          `cmp qword ptr [slot],0; jz helper; jmp qword ptr [slot]`
//          slot 是 IAT 项，存真实函数指针，首次调用前为 0。
//       c) **hook IAT slot 的值**（改写 slot 存的函数指针）→ QQ 调 napi_* 时
//          直接进我们的 hook。不碰代码段 → 不触发 CFG，绝对安全。
//          （v6 曾 inline hook stub：含分支不可搬移 → 栈溢出 0xc00000fd 崩溃）
//       d) hook 触发拿到 napi_env → napi_run_script 执行
//          `process.mainModule.require(boot.cjs)` → boot.cjs hook process.dlopen
//          截获 wrapper.node exports → startNapuketto。
//
//  真实签名（node_api.h，返回 napi_status = int）：
//   - napi_status napi_set_named_property(napi_env, napi_value, const char*, napi_value)
//   - napi_status napi_define_class(napi_env, const char*, size_t, napi_callback, void*, size_t, napi_property_descriptor*, napi_value*)
//   - napi_status napi_get_global(napi_env, napi_value*)
//   - napi_status napi_create_string_utf8(napi_env, const char*, size_t, napi_value*)
//   - napi_status napi_run_script(napi_env, napi_value, napi_value*)
//   - void napi_module_register(napi_module*)
#include <windows.h>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>

// ---- node.h 结构（与 Node 20+ / Electron 兼容的最小子集，自研声明） ----
typedef struct napi_env__ *napi_env;
typedef void *napi_value;

// napi_module（node_api.h）：nm_register_func 是注册回调
struct napi_module {
    int nm_version;
    unsigned int nm_flags;
    const char* nm_filename;
    napi_value (*nm_register_func)(napi_env env, napi_value exports);
    const char* nm_modname;
    void* nm_priv;
    void* reserved[4];
};

// 真实 NAPI 签名（返回 napi_status = int）
typedef int (*fn_napi_create_string_utf8)(napi_env, const char*, size_t, napi_value*);
typedef int (*fn_napi_run_script)(napi_env, napi_value, napi_value*);
typedef int (*fn_napi_define_class)(napi_env, const char*, size_t, void*, void*, size_t, void*, napi_value*);
typedef int (*fn_napi_set_named_property)(napi_env, napi_value, const char*, napi_value);
typedef int (*fn_napi_get_global)(napi_env, napi_value*);
typedef int (*fn_napi_create_object)(napi_env, napi_value*);
typedef void (*fn_napi_module_register)(struct napi_module*);

// ---- 从 QQ.exe 动态解析的函数（napi_run_script / create_string_utf8 不 hook） ----
static fn_napi_create_string_utf8 g_napiCreateStringUtf8 = nullptr;
static fn_napi_run_script g_napiRunScriptRaw = nullptr;
static fn_napi_get_global g_napiGetGlobal = nullptr;
static fn_napi_create_object g_napiCreateObject = nullptr;
static fn_napi_set_named_property g_napiSetNamedPropertyRaw = nullptr;

static HMODULE g_hMain = nullptr;

static FARPROC resolveNapi(const char* name) {
    FARPROC p = GetProcAddress(g_hMain, name);
    if (p) return p;
    HMODULE hQqnt = GetModuleHandleA("QQNT.dll");
    if (hQqnt) return GetProcAddress(hQqnt, name);
    return nullptr;
}

// boot JS 文件路径（由环境变量注入）
static std::string g_bootJsPath;

// 日志（boot 阶段无 pino，写文件到 NAPUTO_CFG_DIR）
static void logMsg(const std::string& msg) {
    char buf[1024] = {0};
    std::string dir = ".";
    if (GetEnvironmentVariableA("NAPUTO_CFG_DIR", buf, sizeof(buf)) > 0) {
        dir = buf;
    }
    std::string path = dir + "\\napuketto-hookdll.log";
    HANDLE h = CreateFileA(path.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE,
                           nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h != INVALID_HANDLE_VALUE) {
        std::string line = "[" + std::to_string(GetTickCount64()) + "ms] " + msg + "\n";
        DWORD w = 0;
        WriteFile(h, line.c_str(), (DWORD)line.size(), &w, nullptr);
        CloseHandle(h);
    }
}

// ---- 全局状态 ----
static volatile LONG g_bootStarted = 0;
static napi_value (*g_wrapperRegisterFunc)(napi_env, napi_value) = nullptr;
static napi_env g_wrapperEnv = nullptr; // 保存的 env（其它 napi hook 触发时更新）

// ---- IAT hook 槽位 ----
struct IatHookSlot {
    uintptr_t* iat = nullptr; // IAT 项地址
    uintptr_t orig = 0;       // 原始函数指针
    const char* name = nullptr;
};

static IatHookSlot g_iat[4];
static int g_iatCount = 0;

// 从 stub 解析 IAT slot 地址（p 是 stub 起点，找 FF 25 的 disp）
// FF 25 = jmp [rip+disp]：slot = rip+disp 处（存函数指针）
static uintptr_t* findIatSlot(uint8_t* stub) {
    for (int i = 0; i + 5 < 16; i++) {
        if (stub[i] == 0xFF && stub[i + 1] == 0x25) {
            int32_t disp = 0;
            memcpy(&disp, stub + i + 2, 4);
            return (uintptr_t*)(stub + i + 6 + disp);
        }
        if (stub[i] == 0xE9) { // 直接跳转，跟进
            int32_t disp = 0;
            memcpy(&disp, stub + i + 1, 4);
            stub = stub + i + 5 + disp;
            i = -1;
            continue;
        }
    }
    return nullptr;
}

// 执行 boot JS：napi_run_script 执行 `process.mainModule.require(bootPath)`
// boot.cjs 作为 CJS 模块被 require → 内部 require/module 正常注入。
static void runBootJs(napi_env env) {
    if (!g_napiCreateStringUtf8 || !g_napiRunScriptRaw || g_bootJsPath.empty()) {
        logMsg("hook: napi 符号或 boot 路径未就绪，跳过 boot JS");
        return;
    }
    // 若已捕获 wrapper 的 register func：直接调用生成 exports 挂到 globalThis
    if (g_wrapperRegisterFunc && g_napiCreateObject && g_napiGetGlobal && g_napiSetNamedPropertyRaw) {
        napi_value exports = nullptr;
        napi_value global = nullptr;
        if (g_napiCreateObject(env, &exports) == 0 && exports &&
            g_napiGetGlobal(env, &global) == 0 && global) {
            g_wrapperRegisterFunc(env, exports);
            g_napiSetNamedPropertyRaw(env, global, "__napukettoWrapperExports", exports);
            logMsg("hook: 已生成 wrapper exports 并挂到 globalThis.__napukettoWrapperExports");
        } else {
            logMsg("hook: 生成 wrapper exports 失败（createObject/getGlobal）");
        }
    } else {
        logMsg("hook: wrapper register func 未捕获（等待 napi_module_register），boot 稍后轮询读取");
    }
    // 引导脚本（process 全局在 Node 环境可用；require 通过 mainModule 拿）
    std::string bootLoader = "process.mainModule.require(process.env.NAPUTO_BOOT_JS);";
    napi_value src = nullptr;
    if (g_napiCreateStringUtf8(env, bootLoader.c_str(), bootLoader.size(), &src) != 0 || !src) {
        logMsg("hook: napi_create_string_utf8 失败");
        return;
    }
    napi_value result = nullptr;
    int status = g_napiRunScriptRaw(env, src, &result);
    logMsg("hook: boot JS 已执行, status=" + std::to_string(status));
}

// ---- 各 hook 函数（IAT hook：改 slot 值，原函数指针在 g_iat[idx].orig） ----
static fn_napi_module_register g_napiModuleRegisterOrig = nullptr;
static std::string g_wrapperFilename;

// napi_module_register：捕获 wrapper.node 模块的 register func
static void HookNapiModuleRegister(struct napi_module* mod) {
    if (mod && mod->nm_filename) {
        std::string fn = mod->nm_filename;
        if (fn.find("wrapper") != std::string::npos || fn.find("Wrapper") != std::string::npos) {
            g_wrapperRegisterFunc = mod->nm_register_func;
            g_wrapperFilename = fn;
            logMsg("hook: 捕获 wrapper module: filename=" + fn);
        }
    }
    if (g_napiModuleRegisterOrig) {
        g_napiModuleRegisterOrig(mod);
    }
}

static int HookDefineClass(napi_env env, const char* name, size_t len, void* cb, void* data,
                           size_t propCount, void* props, napi_value* result) {
    g_wrapperEnv = env;
    if (InterlockedCompareExchange(&g_bootStarted, 1, 0) == 0) {
        logMsg(std::string("hook: napi_define_class -> env, name=") + (name ? name : "?"));
        runBootJs(env);
    }
    typedef int (*Fn)(napi_env, const char*, size_t, void*, void*, size_t, void*, napi_value*);
    return ((Fn)g_iat[1].orig)(env, name, len, cb, data, propCount, props, result);
}

static int HookSetNamedProperty(napi_env env, napi_value obj, const char* key, napi_value val) {
    g_wrapperEnv = env;
    if (InterlockedCompareExchange(&g_bootStarted, 1, 0) == 0) {
        logMsg(std::string("hook: napi_set_named_property -> env, key=") + (key ? key : "?"));
        runBootJs(env);
    }
    typedef int (*Fn)(napi_env, napi_value, const char*, napi_value);
    return ((Fn)g_iat[2].orig)(env, obj, key, val);
}

static int HookGetGlobal(napi_env env, napi_value* result) {
    g_wrapperEnv = env;
    if (InterlockedCompareExchange(&g_bootStarted, 1, 0) == 0) {
        logMsg("hook: napi_get_global -> env");
        runBootJs(env);
    }
    typedef int (*Fn)(napi_env, napi_value*);
    return ((Fn)g_iat[3].orig)(env, result);
}

// 按名字找 hook 函数（延迟填充用）
static void* targetHookForName(const char* name) {
    if (strcmp(name, "napi_module_register") == 0) return (void*)&HookNapiModuleRegister;
    if (strcmp(name, "napi_define_class") == 0) return (void*)&HookDefineClass;
    if (strcmp(name, "napi_set_named_property") == 0) return (void*)&HookSetNamedProperty;
    if (strcmp(name, "napi_get_global") == 0) return (void*)&HookGetGlobal;
    return nullptr;
}

// 安装 IAT hook：改 slot 值 → hookFn；slot 未初始化（0）则登记等填充
static bool installIatHook(int idx, FARPROC stub, void* hookFn, const char* name) {
    uintptr_t* slot = findIatSlot((uint8_t*)stub);
    if (!slot) {
        logMsg(std::string("hook: 找不到 IAT slot: ") + name);
        return false;
    }
    uintptr_t fn = *slot;
    if (fn == 0) {
        logMsg(std::string("hook: ") + name + " IAT slot 未初始化（延迟加载），等待填充...");
        g_iat[g_iatCount] = {slot, 0, name};
        g_iatCount++;
        return false;
    }
    g_iat[g_iatCount] = {slot, fn, name};
    g_iatCount++;
    *slot = (uintptr_t)hookFn;
    logMsg(std::string("hook: ") + name + " IAT hooked: orig=0x" + std::to_string(fn));
    return true;
}

// ---- 引导入口（后台线程，轮询解析符号 + 装 hook）----
static DWORD WINAPI BootstrapThread(LPVOID) {
    for (int i = 0; i < 40; i++) { // 最长 ~20s
        g_hMain = GetModuleHandleA(nullptr); // QQ.exe
        if (g_hMain) break;
        Sleep(500);
    }
    if (!g_hMain) {
        logMsg("hook: QQ.exe 主模块不可达");
        return 1;
    }
    for (int i = 0; i < 60; i++) { // 最长 ~30s
        g_napiCreateStringUtf8 = (fn_napi_create_string_utf8)resolveNapi("napi_create_string_utf8");
        g_napiRunScriptRaw = (fn_napi_run_script)resolveNapi("napi_run_script");
        g_napiGetGlobal = (fn_napi_get_global)resolveNapi("napi_get_global");
        g_napiCreateObject = (fn_napi_create_object)resolveNapi("napi_create_object");
        g_napiSetNamedPropertyRaw = (fn_napi_set_named_property)resolveNapi("napi_set_named_property");
        if (g_napiCreateStringUtf8 && g_napiRunScriptRaw) break;
        Sleep(500);
    }
    if (!g_napiCreateStringUtf8 || !g_napiRunScriptRaw) {
        logMsg("hook: napi 符号解析失败");
        return 1;
    }
    logMsg("hook: napi 符号就绪，安装 hooks");

    struct { const char* name; void* hookFn; } targets[] = {
        {"napi_module_register", (void*)&HookNapiModuleRegister},
        {"napi_define_class", (void*)&HookDefineClass},
        {"napi_set_named_property", (void*)&HookSetNamedProperty},
        {"napi_get_global", (void*)&HookGetGlobal},
    };
    int total = sizeof(targets) / sizeof(targets[0]);
    int installed = 0;
    for (int i = 0; i < total; i++) {
        FARPROC t = resolveNapi(targets[i].name);
        if (!t) {
            logMsg(std::string("hook: 找不到 ") + targets[i].name);
            continue;
        }
        // napi_module_register 的原始指针（hook 内转发用）
        if (strcmp(targets[i].name, "napi_module_register") == 0) {
            uintptr_t* slot = findIatSlot((uint8_t*)t);
            g_napiModuleRegisterOrig = slot ? (fn_napi_module_register)(*slot) : nullptr;
        }
        if (installIatHook(i, t, targets[i].hookFn, targets[i].name)) {
            installed++;
            logMsg(std::string("hook: ") + targets[i].name + " IAT hook 已安装");
        }
    }
    logMsg("hook: 安装完成, " + std::to_string(installed) + "/" + std::to_string(total) + " 已装");

    // 轮询等待延迟加载的 IAT slot 填好（delay-load 首次调用后填）
    for (int i = 0; i < 60; i++) { // 最长 ~30s
        Sleep(1000);
        bool changed = false;
        for (int j = 0; j < g_iatCount; j++) {
            IatHookSlot& s = g_iat[j];
            if (s.iat == nullptr || s.orig != 0) continue; // 已装
            uintptr_t fn = *(s.iat);
            if (fn != 0) { // 填好了
                s.orig = fn;
                *(s.iat) = (uintptr_t)targetHookForName(s.name);
                logMsg(std::string("hook: 延迟加载填充 ") + s.name + " -> IAT hooked (orig=0x" +
                       std::to_string(fn) + ")");
                changed = true;
                if (g_bootStarted) return 0;
            }
        }
        bool allDone = true;
        for (int j = 0; j < g_iatCount; j++) {
            if (g_iat[j].orig == 0) { allDone = false; break; }
        }
        if (allDone || g_bootStarted) break;
        if (!changed) break; // 无变化，停止轮询（等 QQ preload 触发）
    }
    return 0;
}

// DllMain：注入后由 LoadLibrary 触发
BOOL WINAPI DllMain(HINSTANCE hinstDLL, DWORD fdwReason, LPVOID) {
    if (fdwReason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hinstDLL);
        char buf[2048] = {0};
        if (GetEnvironmentVariableA("NAPUTO_BOOT_JS", buf, sizeof(buf)) > 0) {
            g_bootJsPath = buf;
        }
        logMsg("hook: DllMain attach, bootJs=" + g_bootJsPath);
        CreateThread(nullptr, 0, BootstrapThread, nullptr, 0, nullptr);
    }
    return TRUE;
}
