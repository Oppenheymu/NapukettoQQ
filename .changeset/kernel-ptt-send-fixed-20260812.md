---
"@napuketto/kernel": patch
---

fix(kernel): 修复语音发送失败与进程崩溃重启（PTT 元素 NapCat 式预处理）

此前 `toSendElements` 对 voice 元素只传 `{ filePath }`，wrapper 内部转换 pttElement
时缺字段抛 "Cannot convert undefined or null to object"，且发送后进程崩溃
（supervisor 自动重启）。现实现 `preparePttElement`：md5/文件大小计算 →
`getRichMediaFilePathForGuild` → `util.copyFile` 放置 → 完整 pttElement
（md5HexStr/fileSize/duration/formatType/voiceType/canConvert2Text/waveAmplitudes
等，与 PIC 预处理同构）。非 silk 输入（ogg/amr 等）由 wrapper 内部转码，
实测语音发送成功（sendStatus=2 + 真实 fileUuid）。
