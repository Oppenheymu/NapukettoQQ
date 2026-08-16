/**
 * 音频（silk-wasm + ffmpeg）
 *
 * - `decodeSilkToPcm`：SILK → pcm_s16le 文件 + 时长
 * - `encodePcmToSilk`：任意音频（wav/pcm/mp3/ogg/amr/flac…）→ SILK 文件
 * - `getSilkInfo`：SILK 音频信息（时长 / 采样率）
 *
 * silk-wasm 的 `encode` 只接受「单声道 16-bit PCM WAV / 单声道 pcm_s16le」；立体声、非 16-bit、
 * 或压缩编码（mp3/ogg/amr/flac 等）一律先经 ffmpeg 归一化为 24000Hz 单声道 pcm_s16le 再编码
 * （QQ 语音协议 silk v3 固定 24000Hz，ffmpeg 用法同 video.ts，依赖系统 PATH 中的 ffmpeg）。
 */
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execa } from "execa";
import { decode, encode, getDuration, getWavFileInfo, isSilk, isWav } from "silk-wasm";
import type { AudioInfo, DecodedAudio } from "./types.js";
import { MediaError } from "./types.js";

/** SILK 默认采样率（Hz）。 */
export const SILK_SAMPLE_RATE = 24_000;

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

/**
 * 编码任意音频为 SILK 文件（返回输出路径，输出紧随输入文件）。
 *
 * - 已是 SILK → 原样返回
 * - 单声道 16-bit PCM WAV / 显式采样率的原始 pcm_s16le → silk-wasm 直接编码
 * - 其余（立体声/浮点/非 16-bit WAV、mp3/ogg/amr/flac 等）→ ffmpeg 归一化为
 *   24000Hz 单声道 pcm_s16le → silk-wasm 编码
 */
export async function encodePcmToSilk(input: string, sampleRate = 0): Promise<string> {
    const buffer = await readFile(input);
    if (isSilk(buffer)) {
        return input;
    }

    let result: { data: Uint8Array };
    if (isWav(buffer)) {
        const info = getWavFileInfo(buffer);
        const mono16Pcm =
            info.fmt.numberOfChannels === 1 &&
            info.fmt.formatCode === 1 &&
            info.fmt.bitsPerSample === 16;
        if (mono16Pcm) {
            // 单声道 16-bit PCM WAV：silk-wasm 可直接编码（rate=0 自动读 WAV 头）
            result = await encode(buffer, 0);
        } else {
            // 立体声 / 非 16-bit（浮点、24bit）/ 压缩 WAV → ffmpeg 归一化
            result = await encode(await normalizeToPcm(input), SILK_SAMPLE_RATE);
        }
    } else if (sampleRate > 0) {
        // 原始 pcm_s16le（调用方显式指定采样率）
        result = await encode(buffer, sampleRate);
    } else {
        // mp3/ogg/amr/flac 等压缩编码（未指定采样率，无法当 PCM 直接喂 silk-wasm）
        result = await encode(await normalizeToPcm(input), SILK_SAMPLE_RATE);
    }

    const silkPath = replaceExt(input, ".silk");
    await writeFile(silkPath, result.data);
    return silkPath;
}

/**
 * ffmpeg 归一化：任意音频 → 24000Hz 单声道 pcm_s16le（写临时文件，返回 PCM 数据）。
 *
 * 输入目录与 .silk 输出同目录（保证可写），临时文件编码后删除。
 */
async function normalizeToPcm(input: string): Promise<Uint8Array> {
    const tmpPath = join(dirname(input), `.napuketto-${randomBytes(8).toString("hex")}.pcm`);
    try {
        const result = await execa(
            "ffmpeg",
            [
                "-y",
                "-i",
                input,
                "-vn",
                "-ac",
                "1",
                "-ar",
                String(SILK_SAMPLE_RATE),
                "-f",
                "s16le",
                tmpPath,
            ],
            { reject: false },
        );
        if (result.exitCode !== 0) {
            throw new MediaError(
                `ffmpeg 音频归一化失败: ${input}（exit ${result.exitCode ?? "spawn failed"}）`,
            );
        }
        return new Uint8Array(await readFile(tmpPath));
    } finally {
        // 忽略临时文件清理失败（force 已容忍不存在，此处兜底其余清理错误）
        await rm(tmpPath, { force: true }).catch(() => undefined);
    }
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
    // silk-wasm 不暴露 silk 内部采样率；QQ 语音 silk v3 固定 24000Hz，沿用调用方值。
    return { durationMs: getDuration(buffer), sampleRate };
}
