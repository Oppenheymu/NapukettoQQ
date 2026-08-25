# @napuketto/media

## 0.0.3

### Patch Changes

- 3f99e1f: fix(media): 补充 CJS 入口（双格式构建 + exports require 条件），修复 koishi 适配器生产加载报 ERR_PACKAGE_PATH_NOT_EXPORTED。execa / file-type（ESM-only）强制打进产物，避免 CJS require 抛 ERR_REQUIRE_ESM。

## 0.0.2

### Patch Changes

- 2c099aa: fix(media): 修复语音发送「显示 3 分钟却只播放 5 秒」——encodePcmToSilk 对非 WAV 输入（mp3/ogg/amr 等）原本把压缩字节当 PCM 且采样率传 0 触发 silk-wasm「divide by zero」，被上层静默回落为原文件原样发送，导致时长按文件大小估算严重失真、QQ 端只播放开头一小段；现改为经 ffmpeg 归一化为 24000Hz 单声道 pcm_s16le 再编码，同时修复立体声 WAV 被 silk-wasm 只取单声道导致时长减半的问题。
