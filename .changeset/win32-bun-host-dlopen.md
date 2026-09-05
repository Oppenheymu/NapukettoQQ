---
"@napuketto/loader": patch
---

fix(loader): win32 非 node 宿主（Bun 运行时的 koishi 等）自动解析真 node.exe 作自建宿主——此前盲用 process.execPath，Bun 下宿主为 bun.exe，stub QQNT.dll 绑定 node.exe 符号致 wrapper.node dlopen 报 1114「DLL 初始化例程失败」。解析顺序：显式（winNodePath 参数 / NAPUTO_WIN_NODE_PATH）> 系统 PATH node > ensureWinNode 下载（缓存幂等）。
