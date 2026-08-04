/**
 * @napuketto/media 统一返回结构（ADR-011）
 *
 * 媒体编解码与文件识别的公共类型：图片尺寸、文件类型、音频/视频信息。
 */

/** 图片尺寸（宽高，像素）。 */
export interface ImageSize {
    width: number;
    height: number;
}

/** 文件类型识别结果。 */
export interface FileTypeResult {
    /** 扩展名（不带点，如 "png" / "mp3"）。 */
    ext: string;
    /** MIME 类型，如 "image/png" / "audio/mpeg"。 */
    mime: string;
}

/** 音频信息。 */
export interface AudioInfo {
    /** 时长（毫秒）。 */
    durationMs: number;
    /** 采样率（Hz），如 24000。 */
    sampleRate: number;
}

/** 视频信息。 */
export interface VideoInfo {
    width: number;
    height: number;
    /** 时长（毫秒）。 */
    durationMs: number;
}

/** 视频转码选项。 */
export interface TranscodeOptions {
    width?: number;
    height?: number;
    fps?: number;
}

/** SILK 解码产物（pcm_s16le）。 */
export interface DecodedAudio {
    /** PCM 文件路径。 */
    pcmPath: string;
    /** 时长（毫秒）。 */
    durationMs: number;
}

/** 无法识别的文件类型（file-type 返回 undefined 时）。 */
export class MediaError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "MediaError";
    }
}
