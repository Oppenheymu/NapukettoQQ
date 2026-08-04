/**
 * @napuketto/media 入口（媒体编解码与文件识别，ADR-011）
 *
 * 严格解耦：只被协议层（adapter）依赖，kernel 不背媒体依赖。
 */
export { decodeSilkToPcm, encodePcmToSilk, getSilkInfo, SILK_SAMPLE_RATE } from "./audio.js";
export { detectFileType, getImageSize } from "./image.js";
export type {
    AudioInfo,
    DecodedAudio,
    FileTypeResult,
    ImageSize,
    TranscodeOptions,
    VideoInfo,
} from "./types.js";
export { MediaError } from "./types.js";
export { getVideoInfo, transcodeVideo } from "./video.js";
