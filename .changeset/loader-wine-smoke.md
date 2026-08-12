---
"@napuketto/loader": patch
---

feat(loader): Linux/wine 冒烟脚本 + 实测验证记录（P2 Step 1 固化）

- `scripts/wine-smoke.mjs`：WSL2 一键冒烟——确保 QQ 文件（P1 自动下载解包）→ 确保 Windows 版 node.exe（P2）→ wine 跑 win-node → dlopen wrapper.node → 断言 98 exports
- 实测验证通过（2026-08-12 WSL2）：wine 跑 Windows node.exe ✅ / stub QQNT.dll PE 转发在 wine 下生效 ✅ / dlopen wrapper.node 98 exports ✅
- 设计文档 §3.3 记录实测坑：**wine 读 DrvFS（/mnt/c）会 "File not found"，QQ 文件必须放 ext4**（Docker 无此问题）；dlopen 参数形态 `const m={exports:{}}; process.dlopen(m, ...)`
