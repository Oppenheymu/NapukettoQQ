# GhidraMCP 逆向辅助（2026-08-05 配置）

> 用途：分析 `wrapper.node`（C++ ABI，QQ NT 原生模块），辅助 P1-3（构造 session.init() 参数）及后续
> service 方法面 / SessionConfig 结构 / 实体形状的探测。

## 架构

```
VS Code (MCP 客户端, .vscode/mcp.json)
    │  SSE http://127.0.0.1:8081/sse
    ▼
bridge_mcp_ghidra.py  (Python MCP 桥, 默认端口 8081)
    │  HTTP
    ▼
Ghidra GUI 内 GhidraMCP 插件  (HTTP server, 默认端口 8080)
    └─ 已打开的程序（wrapper.node）
```

## 已安装

- Ghidra 12.1.2 → `C:\Dev\Tools\ghidra_12.1.2_PUBLIC\`（解压后）
- 下载包 → `C:\Dev\Tools\ghidra.zip`
- **GhidraMCP 1.4 插件已修复安装**（manifest 改 Ghidra 12 格式）→
  `C:\Users\xiaoxiaochen\AppData\Roaming\ghidra\ghidra_12.1.2_PUBLIC\Extensions\GhidraMCP\`
  （注意：Ghidra 12 的用户扩展目录在 `AppData\Roaming\ghidra\...`，不是 `~/.ghidra/`）
- **wrapper.node 已导入并全量分析** → 项目 `C:\Dev\Tools\ghidra-project\NapukettoWrapper.gpr`
  （headless 分析完成，GUI 打开项目直接复用结果，无需重新分析）
- VS Code MCP 配置 → `.vscode/mcp.json`（`http://127.0.0.1:8081/sse`）
- Python 桥 → `python "C:\Dev\Tools\GhidraMCP-1-4\GhidraMCP-release-1-4\bridge_mcp_ghidra.py" --transport sse --mcp-port 8081`
  （依赖已装：mcp 1.29.0 + requests）

## 使用步骤（用户操作，每次分析前）

1. **启动 Ghidra**：`C:\Dev\Tools\ghidra_12.1.2_PUBLIC\ghidraRun.bat`
2. **打开项目**（分析结果已存好）：`File → Open Project` → `C:\Dev\Tools\ghidra-project\NapukettoWrapper.gpr`
   → 双击 `wrapper.node`（若提示分析已完成，直接进入反编译视图）
3. **确认 GhidraMCP 插件启用**：`File → Configure → Developer → GhidraMCPPlugin`（若未启用则勾选；
   端口 `Edit → Tool Options → GhidraMCP HTTP Server` 默认 8080）
4. **启动 Python 桥**（新开终端，如未运行）：
   ```powershell
   python "C:\Dev\Tools\GhidraMCP-1-4\GhidraMCP-release-1-4\bridge_mcp_ghidra.py" --transport sse --mcp-host 127.0.0.1 --mcp-port 8081 --ghidra-server http://127.0.0.1:8080/
   ```
5. **VS Code 中重载 MCP**：命令面板 → `MCP: List Servers`（或重载窗口），`ghidra` server 应显示已连接

## RVA 换算（P1-3 已确定）

- 运行时基址 = vtable 运行时 − vtable RVA = `0x7ffc046ec368 − 0x395e368` = **`0x7ffc00d8e000`**
- 函数 Ghidra 地址 = `0x180000000 + (运行时地址 − 0x7ffc00d8e000)`
  （Ghidra PE image base = `0x180000000`）
- **init 候选**：INTSessionShell vtable 槽位 16，运行时 `0x7ffc00dc5186` → **RVA `0x37186`** → **`0x180037186`**
- 其他槽位 RVA 同理换算（槽位表见会话记忆 /memories/session/p1-3-init-hunt.md）

## MCP 常用工具（对 P1-3 最有用的）

- `decompile_function(address)` → C 伪代码。目标：`0x180037186`（init 候选槽位 16）
- `disassemble_function(address)` / `list_functions()` / `search_functions_by_name(name)`
- `/strings`（RTTI 类名、SessionConfig 字段名、init 标记字符串）
- `get_xrefs_to(address)` → 谁调用 init / 谁构造 SessionConfig

## 已知坑（2026-08-05）

- **Ghidra 12.1.2 headless 的 Java 脚本 OSGi 编译失败**（JDK 25/21 均偶发，含无 import 脚本）→
  不要依赖 headless 脚本，用 GUI + MCP 插件反编译
- Ghidra 12 无 PyGhidra（Jython 不可用）
- GhidraMCP 1.4 原始 zip 的 Module.manifest 是旧格式（GHIDRA_MODULE_*），Ghidra 12 报错——已修复
  （清空 manifest + properties 去 ghidraVersion 字段）
- 若 GUI 打不开项目：先确认 headless 分析进程已退出（`Get-Process java`），项目锁才释放

## 与现有探测脚本的配合

- 探测脚本（`packages/kernel/scripts/probe/`）定位运行时地址/槽位 → Ghidra 里转 RVA 反编译确认语义
- Ghidra 里确认结构布局（SessionConfig@im_core 字段偏移）→ 回写探测脚本构造 FFI 参数
