# @napuketto/media 设计

> 职责：**媒体编解码与文件识别**。严格解耦，只被协议层（onebot）依赖。
> 对应 ADR：011
> 状态：全部模块已实现（types / image / audio / video，2026-08-04，见 §7），通过 `pnpm check` + 8 项运行时冒烟测试（video 依赖系统 ffmpeg，本机未安装故跳过运行时验证）。

---

## 1. 边界

- **做**：音频（silk 编解码）、视频（ffmpeg 转码/取信息）、文件类型识别、图片尺寸读取。
- **不做**：QQ 业务逻辑、缓存、协议语义。

依赖：`silk-wasm`、`execa`、`file-type`、`image-size`。**零内部包依赖**（kernel 不依赖本包，保持纯净）。

> **ffmpeg 的调用方式**：视频转码 / 取信息一律通过 **execa** 以子进程方式调用系统 PATH 中的 `ffmpeg` / `ffprobe` 二进制——不引入任何 node 侧 ffmpeg 封装库（如 fluent-ffmpeg）。ffmpeg 是**外部运行时依赖**，不属于 npm 依赖（分发策略见 §6）。

## 2. 目录结构

```
packages/media/src/
├── audio.ts        # silk-wasm 编解码（amr/silk ↔ pcm/silk）
├── video.ts        # execa + ffmpeg（转码、取时长/尺寸）
├── image.ts        # image-size（尺寸）+ file-type（类型识别）
└── types.ts        # 统一返回结构（MimeType / MediaInfo 等）
```

## 3. 与 NapCat 的差异

NapCat 把音频/视频/文件工具放在 `common/utils/`，导致 core 层间接背上 ffmpeg/silk 依赖。我们把它们独立成包，只有真正需要发语音/视频的协议 action 才依赖它。

## 4. 接口草案

```ts
// audio.ts
export function decodeSilkToPcm(input: string): Promise<{ pcmPath: string; durationMs: number }>;
export function encodePcmToSilk(input: string): Promise<string>;

// video.ts
export function transcodeVideo(input: string, opts: { width?: number; height?: number; fps?: number }): Promise<string>;
export function getVideoInfo(input: string): Promise<{ width: number; height: number; durationMs: number }>;

// image.ts
export function getImageSize(input: string): Promise<{ width: number; height: number }>;
export function detectFileType(input: string): Promise<{ mime: string; ext: string }>;
```

## 5. 实现顺序

1. ✅ `types.ts` + `image.ts`（最轻，先落地，2026-08-04）
2. ✅ `audio.ts`（silk-wasm）
3. ✅ `video.ts`（execa + ffmpeg）

## 6. 待验证事项

- ffmpeg 二进制分发策略（系统安装 vs 随包携带，P4 前决定）——当前实现依赖系统 PATH 中的 ffmpeg/ffprobe，缺失时 `transcodeVideo` / `getVideoInfo` 抛 `MediaError`。
- ~~silk-wasm 在 Node ESM 环境的加载方式~~ → 已定：silk-wasm 3.x 为纯 WASM（无初始化步骤），输入为 ArrayBuffer，`encode(input, sampleRate)` / `decode(input, sampleRate)` 返回 `{ data, duration }`。

## 7. 实现记录（2026-08-04）

- **silk-wasm 3.x 输入为 ArrayBuffer**：`decodeSilkToPcm` / `encodePcmToSilk` 自行 `readFile` / `writeFile`；输出文件紧随输入（替换扩展名 `.pcm` / `.silk`）。`encode` 的 sampleRate 在输入为 WAV 时传 0 自动识别（silk-wasm 内部解析 WAV 头）。
- **image-size v2 只接受 Uint8Array**（非文件路径）：`getImageSize` 内部 `readFile` 后传入；返回类型 `ISize` 中 width/height 为必选，无需 undefined 检查。
- **file-type v22 用 `fileTypeFromFile(path)`**：按文件路径检测魔数，返回 `{ ext, mime } | undefined`，undefined 时抛 `MediaError`。
- **execa v10**：`execa(cmd, args, { reject: false })`，依赖 exitCode 判断成败；ffprobe 输出 JSON 解析取宽高/时长。
- **错误统一抛 `MediaError`**（本包类型化错误），不静默吞掉；video 失败时 `cause` 携带底层错误。
- **biome 严格规则适配**：SILK_SAMPLE_RATE 等导出常量后置（useExportsLast）；ffprobe 的 `codec_type` 字段用 `["codec_type"]` 访问（useNamingConvention 只认 camelCase，字段名来自 ffprobe JSON 不可改）。
