// NapukettoWinBootHook: 注入 QQ 主进程后，通过 node 的 NAPI 注册表注册自研模块，
// 让 Electron 主进程加载 boot 脚本（纯 NAPI，不碰 C++ ABI）。
//
// 原理（2026-08-05 实测）：
//   - wrapper.node 只在 QQ 定制 Electron 里能注册（preload 机制）。
//   - QQ.exe 导出全套 napi_* 符号（静态导出表探测确认：napi_define_class /
//     napi_set_named_property / napi_create_string_utf8 / napi_run_script 等 464 个）。
//   - 触发机制（v4，修复 v3 崩溃）：
//       a) QQ 9.9.31 JS 全量字节码化，preload 不走 napi_run_script（v2 实测）。
//       b) preload 注册 wrapper.node 类时**必然调用 napi_set_named_property /
//          napi_define_class 等**，第一参就是 napi_env——hook 这些**低频**函数。
//       c) 拿到 env 后，用 napi_run_script 执行 `process.mainModule.require(boot.cjs)`
//          （boot.cjs 作为 CJS 模块加载，require 注入正常）。
//       d) boot.cjs hook process.dlopen 截获 wrapper.node exports。
//   - v3 崩溃根因（已修）：runBootJs 调用的 g_napiRunScript 是被 hook 的入口 →
//     递归进 HookRunScript → trampoline 原字节含 RIP 相对寻址，搬址后偏移失效 → 崩。
//     修复：**不 hook napi_run_script**（runBootJs 用原始指针）；hook 前检测 RIP
//     相对指令（有则放弃该函数，安全优先）。
//
//  真实签名（node_api.h，返回 napi_status = int）：
//   - napi_status napi_set_named_property(napi_env, napi_value, const char*, napi_value)
//   - napi_status napi_define_class(napi_env, const char*, size_t, napi_callback, void*, size_t, napi_property_descriptor*, napi_value*)
//   - napi_status napi_get_global(napi_env, napi_value*)
//   - napi_status napi_create_string_utf8(napi_env, const char*, size_t, napi_value*)
//   - napi_status napi_run_script(napi_env, napi_value, napi_value*)
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

// ---- 全局状态（wrapper 捕获 / hook 槽位） ----
static napi_value (*g_wrapperRegisterFunc)(napi_env, napi_value) = nullptr;
static napi_env g_wrapperEnv = nullptr; // 保存的 env（其它 napi hook 触发时更新）

// ---- 通用 inline hook（x64 detour，自研） ----
// 覆盖目标前 12 字节为: mov rax, <hookAddr>; jmp rax
// trampoline: <原12字节>; mov rax, <orig+12>; jmp rax
static constexpr size_t PATCH_LEN = 12;
static constexpr size_t TRAMPOLINE_LEN = PATCH_LEN + 12;

struct HookSlot {
    void* target = nullptr;
    uint8_t* trampoline = nullptr;
    uint8_t origBytes[PATCH_LEN] = {0};
};

static HookSlot g_slots[6];
static int g_slotCount = 0;
static volatile LONG g_bootStarted = 0;

// ---- 卸载 hook（还原字节，boot 启动后调用） ----
static void unhookAll() {
    for (int i = 0; i < g_slotCount; i++) {
        if (!g_slots[i].target) continue;
        uint8_t* p = (uint8_t*)g_slots[i].target;
        DWORD oldProt = 0;
        VirtualProtect(p, PATCH_LEN, PAGE_EXECUTE_READWRITE, &oldProt);
        memcpy(p, g_slots[i].origBytes, PATCH_LEN);
        VirtualProtect(p, PATCH_LEN, oldProt, &oldProt);
        FlushInstructionCache(GetCurrentProcess(), p, PATCH_LEN);
        g_slots[i].target = nullptr;
    }
    logMsg("hook: 已卸载全部 hooks，QQ 恢复正常");
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
    // boot 已启动，卸载所有 hook（QQ 恢复正常，避免高频 trampoline 触发 CFG 拦截）
    unhookAll();
}

// ---- napi_module_register hook（捕获 wrapper.node 的 register func） ----
static fn_napi_module_register g_napiModuleRegisterOrig = nullptr;
static std::string g_wrapperFilename;

// hook 后的 napi_module_register：记录 wrapper.node 模块的 register func
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

// 真正执行转发（C++ 侧）：直接调用 trampoline
// 各 hook 函数用匹配签名直接调 trampoline（编译器处理参数传递）
static int fwd_define_class(napi_env env, const char* name, size_t len, void* cb, void* data,
                            size_t propCount, void* props, napi_value* result, uint8_t* tr) {
    typedef int (*Fn)(napi_env, const char*, size_t, void*, void*, size_t, void*, napi_value*);
    return ((Fn)tr)(env, name, len, cb, data, propCount, props, result);
}
static int fwd_set_named_property(napi_env env, napi_value obj, const char* key, napi_value val, uint8_t* tr) {
    typedef int (*Fn)(napi_env, napi_value, const char*, napi_value);
    return ((Fn)tr)(env, obj, key, val);
}
static int fwd_get_global(napi_env env, napi_value* result, uint8_t* tr) {
    typedef int (*Fn)(napi_env, napi_value*);
    return ((Fn)tr)(env, result);
}

// ---- 各 hook 函数（匹配真实签名，调用公共逻辑） ----
// 只 hook 低频函数（preload 注册 wrapper 时必调但调用频率低）。
// 高频函数（napi_set_named_property 实测定会被调用但可能高频）不 hook 会漏触发，
// 所以保留它——但 runBootJs 只执行一次（g_bootStarted 原子保护）。
static int HookDefineClass(napi_env env, const char* name, size_t len, void* cb, void* data,
                           size_t propCount, void* props, napi_value* result) {
    g_wrapperEnv = env;
    if (InterlockedCompareExchange(&g_bootStarted, 1, 0) == 0) {
        logMsg(std::string("hook: napi_define_class -> env, name=") + (name ? name : "?"));
        runBootJs(env);
    }
    return fwd_define_class(env, name, len, cb, data, propCount, props, result, g_slots[0].trampoline);
}
static int HookSetNamedProperty(napi_env env, napi_value obj, const char* key, napi_value val) {
    g_wrapperEnv = env;
    if (InterlockedCompareExchange(&g_bootStarted, 1, 0) == 0) {
        logMsg(std::string("hook: napi_set_named_property -> env, key=") + (key ? key : "?"));
        runBootJs(env);
    }
    return fwd_set_named_property(env, obj, key, val, g_slots[1].trampoline);
}
static int HookGetGlobal(napi_env env, napi_value* result) {
    g_wrapperEnv = env;
    if (InterlockedCompareExchange(&g_bootStarted, 1, 0) == 0) {
        logMsg("hook: napi_get_global -> env");
        runBootJs(env);
    }
    return fwd_get_global(env, result, g_slots[2].trampoline);
}

// 写 jmp rax 序列（12 字节：48 B8 imm64 FF E0）
static void emitJump(uint8_t* dst, void* target) {
    dst[0] = 0x48; dst[1] = 0xB8; // mov rax, imm64
    uintptr_t addr = (uintptr_t)target;
    memcpy(dst + 2, &addr, 8);
    dst[10] = 0xFF; dst[11] = 0xE0; // jmp rax
}

// 检测前 12 字节是否含 RIP 相对寻址指令（REX.W + 8B/89/8D/8F + ModRM rm=101）
// 或 48 C7 05/0D 等——trampoline 搬址后偏移失效，检测到就放弃 hook（安全优先）。
static bool hasRipRelative(const uint8_t* p) {
    for (int i = 0; i + 2 < (int)PATCH_LEN; i++) {
        uint8_t b0 = p[i];
        if (b0 != 0x48 && b0 != 0x4C && b0 != 0x4D) continue; // REX.W / REX.WR
        uint8_t b1 = p[i + 1];
        bool isMemOp = (b1 == 0x8B || b1 == 0x89 || b1 == 0x8D || b1 == 0x8F ||
                        b1 == 0x8A || b1 == 0x88 || b1 == 0x3B || b1 == 0x39 ||
                        b1 == 0x2B || b1 == 0x29 || b1 == 0x0B || b1 == 0x09);
        uint8_t modrm = p[i + 2];
        uint8_t mod = (modrm >> 6) & 3;
        uint8_t rm = modrm & 7;
        if (isMemOp && mod == 0 && rm == 5) return true; // [rip+disp32]
    }
    // 48 C7 05/0D（mov qword [rip+disp32], imm32）等
    for (int i = 0; i + 2 < (int)PATCH_LEN; i++) {
        if (p[i] == 0x48 && p[i + 1] == 0xC7 &&
            (p[i + 2] == 0x05 || p[i + 2] == 0x0D)) {
            return true;
        }
    }
    return false;
}

// 安装 hook（slot 编号对应 g_slots 下标）；RIP 相对则拒绝安装
static bool installHook(int slotIdx, void* target, void* hookFn) {
    HookSlot& slot = g_slots[slotIdx];
    uint8_t* p = (uint8_t*)target;
    // dump 前 12 字节（诊断）
    char hex[48] = {0};
    for (int i = 0; i < (int)PATCH_LEN; i++) {
        char b[8] = {0};
        sprintf(b, "%02X ", p[i]);
        strncat(hex, b, sizeof(hex) - strlen(hex) - 1);
    }
    if (hasRipRelative(p)) {
        logMsg(std::string("hook: 目标含 RIP 相对指令，拒绝安装: ") + hex);
        return false;
    }
    logMsg(std::string("hook: 目标字节: ") + hex);
    memcpy(slot.origBytes, p, PATCH_LEN);

    slot.trampoline = (uint8_t*)VirtualAlloc(nullptr, TRAMPOLINE_LEN, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);
    if (!slot.trampoline) return false;
    memcpy(slot.trampoline, p, PATCH_LEN);
    emitJump(slot.trampoline + PATCH_LEN, p + PATCH_LEN);

    DWORD oldProt = 0;
    VirtualProtect(p, PATCH_LEN, PAGE_EXECUTE_READWRITE, &oldProt);
    emitJump(p, hookFn);
    VirtualProtect(p, PATCH_LEN, oldProt, &oldProt);
    FlushInstructionCache(GetCurrentProcess(), p, PATCH_LEN);
    slot.target = target;
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

    // 逐个安装（QQ preload 注册 wrapper 时必调其中若干；不 hook run_script——
    // runBootJs 需要原始指针，且 hook 它会造成 self-hook 递归风险）
    struct { const char* name; void* hookFn; } targets[] = {
        {"napi_module_register", (void*)&HookNapiModuleRegister},
        {"napi_define_class", (void*)&HookDefineClass},
        {"napi_set_named_property", (void*)&HookSetNamedProperty},
        {"napi_get_global", (void*)&HookGetGlobal},
    };
    int installed = 0;
    int total = sizeof(targets) / sizeof(targets[0]);
    for (int i = 0; i < total; i++) {
        FARPROC t = resolveNapi(targets[i].name);
        if (!t) {
            logMsg(std::string("hook: 找不到 ") + targets[i].name);
            continue;
        }
        // 保存原始指针（hook 内转发用）；napi_module_register 单独存
        if (strcmp(targets[i].name, "napi_module_register") == 0) {
            g_napiModuleRegisterOrig = (fn_napi_module_register)t;
        }
        if (installHook(i, (void*)t, targets[i].hookFn)) {
            installed++;
            logMsg(std::string("hook: ") + targets[i].name + " inline hook 已安装");
        } else {
            logMsg(std::string("hook: ") + targets[i].name + " 安装失败");
        }
    }
    logMsg("hook: 安装完成, 共 " + std::to_string(installed) + "/" + std::to_string(total) + " 个 hook");
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
