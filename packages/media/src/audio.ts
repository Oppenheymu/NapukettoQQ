/**
 * 音频（silk-wasm 编解码）
 *
 * - `decodeSilkToPcm`：SILK → pcm_s16le 文件 + 时长
 * - `encodePcmToSilk`：WAV 或单声道 pcm_s16le → SILK 文件
 *
 * silk-wasm 3.x 输入为 ArrayBuffer（非文件路径），需自行读文件 / 写文件。
 * `encode` 的 sampleRate 在输入为 WAV 时可传 0 自动识别。
 */
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { decode, encode, getDuration, isSilk, isWav } from "silk-wasm";
import type { AudioInfo, DecodedAudio } from "./types.js";
import { MediaError } from "./types.js";

/** 替换文件扩展名（保持目录不变，父目录存在性由调用方保证）。 */
function replaceExt(input: string, ext: string): string {
    const dir = dirname(input);
    const base = input.slice(dir.length + 1);
    const dot = base.lastIndexOf(".");
    let stem: string;
    if (dot > 0) {
        stem = base.slice(0, dot);
    } else {
        stem = base;
    }
    const out = `${dir}/${stem}${ext}`;
    mkdirSync(dirname(out), { recursive: true });
    return out;
}

/** 解码 SILK 音频为 PCM（pcm_s16le）。 */
export async function decodeSilkToPcm(
    input: string,
    sampleRate = SILK_SAMPLE_RATE,
): Promise<DecodedAudio> {
    const buffer = await readFile(input);
    if (!isSilk(buffer)) {
        throw new MediaError(`不是有效的 SILK 文件: ${input}`);
    }
    const result = await decode(buffer, sampleRate);
    const pcmPath = replaceExt(input, ".pcm");
    await writeFile(pcmPath, result.data);
    return { pcmPath, durationMs: result.duration };
}

/** 编码 PCM / WAV 为 SILK 文件（返回输出路径，输出紧随输入文件）。 */
export async function encodePcmToSilk(input: string, sampleRate = 0): Promise<string> {
    const buffer = await readFile(input);
    let rate: number;
    if (isWav(buffer)) {
        rate = 0; // WAV 头部自带采样率
    } else {
        rate = sampleRate;
    }
    const result = await encode(buffer, rate);
    const silkPath = replaceExt(input, ".silk");
    await writeFile(silkPath, result.data);
    return silkPath;
}

/** 获取 SILK 音频信息（时长 / 采样率）。 */
export async function getSilkInfo(
    input: string,
    sampleRate = SILK_SAMPLE_RATE,
): Promise<AudioInfo> {
    const buffer = await readFile(input);
    if (!isSilk(buffer)) {
        throw new MediaError(`不是有效的 SILK 文件: ${input}`);
    }
    return { durationMs: getDuration(buffer), sampleRate };
}

/** SILK 默认采样率（Hz）。 */
export const SILK_SAMPLE_RATE = 24_000;
