# @napuketto/media

媒体编解码与识别。

- **image** — 尺寸识别（image-size）+ 类型嗅探（file-type）
- **audio** — silk 编解码（silk-wasm）
- **video** — ffmpeg 转码（execa）

## 约束

- 只被协议层（adapter）依赖；kernel 不背媒体依赖
