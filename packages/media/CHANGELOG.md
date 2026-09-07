# @napuketto/media

## 0.0.4

### Patch Changes

- 43a42e1: feat(media/adapter/loader): get_image/get_record 接主动下载——media 包新增 downloadUrl/inferExtension（fetch + 大小上限 + 超时）；get_image 本地 NT 相对路径按 mediaBaseDir（QQ NT global 目录，装配链经 resolveQqUserDataRoot 解析注入）解析，未命中且有 picUrl 时下载到 cacheDir/media 返回 file；get_record 本地解析命中返回绝对路径（语音主动下载缺口：downloadRichMedia 原生签名未探测，待实测后接入）
- 59e5492: feat(media/adapter): 媒体收发方向接线——media 新增 decodeSilkToWav（silk → 可播放 WAV，收方向语音）并加固 transcodeVideo（exitCode/产物存在性校验，失败抛 MediaError 不再返回幽灵路径）；satori video 非 mp4 输入发送前 ffmpeg 归一化（fail-soft 原样透传）

## 0.0.3

### Patch Changes

- 3f99e1f: fix(media): 补充 CJS 入口（双格式构建 + exports require 条件），修复 koishi 适配器生产加载报 ERR_PACKAGE_PATH_NOT_EXPORTED。execa / file-type（ESM-only）强制打进产物，避免 CJS require 抛 ERR_REQUIRE_ESM。

## 0.0.2

### Patch Changes

- 2c099aa: fix(media): 修复语音发送「显示 3 分钟却只播放 5 秒」——encodePcmToSilk 对非 WAV 输入（mp3/ogg/amr 等）原本把压缩字节当 PCM 且采样率传 0 触发 silk-wasm「divide by zero」，被上层静默回落为原文件原样发送，导致时长按文件大小估算严重失真、QQ 端只播放开头一小段；现改为经 ffmpeg 归一化为 24000Hz 单声道 pcm_s16le 再编码，同时修复立体声 WAV 被 silk-wasm 只取单声道导致时长减半的问题。
