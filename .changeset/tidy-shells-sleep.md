---
"create-napukettoqq": patch
---

修复 Windows 下自动安装依赖时触发 Node ≥22 的 DEP0190 告警（`shell: true` + args 数组改为拼单命令行字符串，规避 `spawn` 参数不转义的弃用警告）。
