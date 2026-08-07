/**
 * get_image / get_record 动作：获取图片/语音文件信息（P2-14，简化版）
 *
 * message_id 反查 → fetchMsgsByMsgId → 找 PIC/PTT 元素 → 返回元素已有路径与 URL。
 * 不做主动下载/转码（NapCat 走 downloadRichMedia 事件驱动下载，待后续接入）。
 */
import { kernelError, type RawElement } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import { resolveMsgIdAndPeer } from "../../helper/message-unique.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getMediaSchema = z.object({
    /** CQ 码 file 字段或 message_id（简化：message_id 反查）。 */
    file: z.string().optional(),
    message_id: z.union([z.number(), z.string()]).optional(),
});

type GetMediaPayload = z.infer<typeof getMediaSchema>;

/** 媒体信息返回。 */
export interface MediaInfoResult {
    file?: string;
    url?: string;
    file_size?: string;
    file_name?: string;
    base64?: string;
}

/** 媒体动作依赖（OneBotApi 视图）。 */
export type GetMediaDeps = Pick<OneBotApi, "msgApi" | "messageUnique">;

/** 从消息元素提取媒体路径与 URL（PIC/PTT，纯函数）。 */
function extractMediaPath(element: RawElement): { path?: string; url?: string } {
    const pic = element.picElement;
    if (pic !== undefined) {
        const out: { path?: string; url?: string } = {};
        const path = pic.sourcePath ?? pic.picPath;
        if (path !== undefined) {
            out.path = path;
        }
        if (pic.picUrl !== undefined) {
            out.url = pic.picUrl;
        }
        return out;
    }
    const ptt = element.pttElement;
    if (ptt !== undefined && ptt.filePath !== undefined) {
        return { path: ptt.filePath };
    }
    return {};
}

/** 获取图片信息（P2-14）。 */
export class GetImageAction extends BaseAction<GetMediaPayload, MediaInfoResult> {
    readonly name = "get_image";
    readonly schema = getMediaSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: GetMediaDeps;

    constructor(deps: GetMediaDeps) {
        super();
        this.deps = deps;
    }

    protected _handle(payload: GetMediaPayload): Promise<MediaInfoResult> {
        return this.resolveMedia(payload, "图片", "get_image");
    }

    /** 反查消息并提取媒体元素路径。 */
    private async resolveMedia(
        payload: GetMediaPayload,
        label: string,
        actionName: string,
    ): Promise<MediaInfoResult> {
        const id = payload.message_id ?? payload.file;
        if (id === undefined) {
            throw kernelError(`${actionName} 需要 message_id 或 file`, "INVALID_PARAM");
        }
        const { msgId, peer } = resolveMsgIdAndPeer(id, this.deps.messageUnique);
        const msgs = await this.deps.msgApi.fetchMsgsByMsgId(peer, [msgId]);
        const [first] = msgs;
        if (first === undefined) {
            throw kernelError(`消息 ${id} 不存在或已被撤回`, "NOT_FOUND");
        }
        let found: { path?: string; url?: string } | undefined;
        for (const el of first.elements) {
            const media = extractMediaPath(el);
            if (media.path !== undefined || media.url !== undefined) {
                found = media;
                break;
            }
        }
        if (found === undefined) {
            throw kernelError(`消息 ${id} 不包含${label}`, "NOT_FOUND");
        }
        const result: MediaInfoResult = {};
        if (found.path !== undefined) {
            result.file = found.path;
        }
        if (found.url !== undefined) {
            result.url = found.url;
        }
        return result;
    }
}

/** 获取语音信息（P2-14）。 */
export class GetRecordAction extends BaseAction<GetMediaPayload, MediaInfoResult> {
    readonly name = "get_record";
    readonly schema = getMediaSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: GetMediaDeps;

    constructor(deps: GetMediaDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: GetMediaPayload): Promise<MediaInfoResult> {
        const id = payload.message_id ?? payload.file;
        if (id === undefined) {
            throw kernelError("get_record 需要 message_id 或 file", "INVALID_PARAM");
        }
        const { msgId, peer } = resolveMsgIdAndPeer(id, this.deps.messageUnique);
        const msgs = await this.deps.msgApi.fetchMsgsByMsgId(peer, [msgId]);
        const [first] = msgs;
        if (first === undefined) {
            throw kernelError(`消息 ${id} 不存在或已被撤回`, "NOT_FOUND");
        }
        for (const el of first.elements) {
            const ptt = el.pttElement;
            if (ptt !== undefined && ptt.filePath !== undefined) {
                return { file: ptt.filePath };
            }
        }
        throw kernelError(`消息 ${id} 不包含语音`, "NOT_FOUND");
    }
}
