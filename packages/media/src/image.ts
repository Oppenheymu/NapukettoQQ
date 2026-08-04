/**
 * 图片与文件识别
 *
 * - `getImageSize`：image-size（读取 Uint8Array，同步计算）
 * - `detectFileType`：file-type（按文件路径检测魔数）
 */
import { readFile } from "node:fs/promises";
import { fileTypeFromFile } from "file-type";
import { imageSize } from "image-size";
import type { FileTypeResult, ImageSize } from "./types.js";
import { MediaError } from "./types.js";

/** 读取图片尺寸（image-size 同步 API，内部读文件 + 计算）。 */
export async function getImageSize(input: string): Promise<ImageSize> {
    const buffer = await readFile(input);
    const size = imageSize(buffer);
    return { width: size.width, height: size.height };
}

/** 检测文件类型（魔数识别，返回 undefined 时抛 MediaError）。 */
export async function detectFileType(input: string): Promise<FileTypeResult> {
    const result = await fileTypeFromFile(input);
    if (result === undefined) {
        throw new MediaError(`无法识别的文件类型: ${input}`);
    }
    return { ext: result.ext, mime: result.mime };
}
