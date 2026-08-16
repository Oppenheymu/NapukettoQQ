---
"@napuketto/media": patch
---

fix(media): 修复语音发送「显示 3 分钟却只播放 5 秒」——encodePcmToSilk 对非 WAV 输入（mp3/ogg/amr 等）原本把压缩字节当 PCM 且采样率传 0 触发 silk-wasm「divide by zero」，被上层静默回落为原文件原样发送，导致时长按文件大小估算严重失真、QQ 端只播放开头一小段；现改为经 ffmpeg 归一化为 24000Hz 单声道 pcm_s16le 再编码，同时修复立体声 WAV 被 silk-wasm 只取单声道导致时长减半的问题。
