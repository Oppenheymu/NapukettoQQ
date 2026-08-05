/**
 * translate_en2zh 动作：英文单词翻译（P2-14 接 kernel RichMediaApi.translateWords）
 */
import type { RichMediaApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const translateEn2ZhSchema = z.object({
    words: z.array(z.string()),
});

type TranslateEn2ZhPayload = z.infer<typeof translateEn2ZhSchema>;

/** 英文单词翻译（P2-14）。 */
export class TranslateEn2ZhAction extends BaseAction<TranslateEn2ZhPayload, { words: string[] }> {
    readonly name = "translate_en2zh";
    readonly schema = translateEn2ZhSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly richMediaApi: RichMediaApi;

    constructor(richMediaApi: RichMediaApi) {
        super();
        this.richMediaApi = richMediaApi;
    }

    protected async _handle(payload: TranslateEn2ZhPayload): Promise<{ words: string[] }> {
        const words = await this.richMediaApi.translateWords(payload.words);
        return { words };
    }
}
