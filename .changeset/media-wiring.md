---
"@napuketto/media": patch
"@napuketto/adapter": patch
---

feat(media/adapter): 媒体收发方向接线——media 新增 decodeSilkToWav（silk → 可播放 WAV，收方向语音）并加固 transcodeVideo（exitCode/产物存在性校验，失败抛 MediaError 不再返回幽灵路径）；satori video 非 mp4 输入发送前 ffmpeg 归一化（fail-soft 原样透传）
