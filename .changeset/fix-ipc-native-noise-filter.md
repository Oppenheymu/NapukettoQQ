---
"@napuketto/loader": patch
"koishi-plugin-adapter-napuketto": patch
---

fix: koishi IPC 通道移植原生噪音过滤——wrapper 原生输出整行不再混入协议流

cli 的 NATIVE_NOISE 过滤移植为 loader 共享助手 `isNativeNoiseLine`（`host/ipc/native-noise.ts` 单一来源，cli 与 koishi IPC 路径同源；IPC 协议行按 `{"v":1` 前缀构造性豁免，防载荷含噪音样文本的消息事件被误滤）。koishi 插件 `ChildProcessIpcTransport` 的 stdout/stderr 行回调接入过滤：整条原生噪音行（MMKV 刷屏 / 符号查找警告等）静默丢弃、不进 onJunkLine 撕裂诊断通道——噪音 ≠ 撕裂，协议行被插断的撕裂仍由 status 重播与脏行诊断兜底。
