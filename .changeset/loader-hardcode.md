---
"@napuketto/loader": patch
---

fix(loader): 清理开发机路径与 UA/版本号硬编码——删除 locate-qq 常见路径探测中的开发机目录候选；下载 User-Agent 改为运行时读自身 package.json 版本（失败兜底 0.0.0）；DEFAULT_WIN_NODE_VERSION 与 SEVEN_ZIP_LINUX_VERSION 补注释说明升级需手动同步。
