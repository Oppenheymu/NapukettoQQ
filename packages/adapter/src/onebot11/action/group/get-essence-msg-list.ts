/**
 * get_essence_msg_list 动作：获取群精华消息列表（P2-15 接 kernel WebApi）
 *
 * qun.qq.com digest_list web 接口 → msg_list。msg_content 映射 text/image 段。
 */
import type { WebApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OB11MessageSegment } from "../../types/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getEssenceMsgListSchema = z.object({
    group_id: z.number(),
});

type GetEssenceMsgListPayload = z.infer<typeof getEssenceMsgListSchema>;

/** 文本段类型（msg_content.msg_type）。 */
const MSG_TYPE_TEXT = 1;
/** 图片段类型（msg_content.msg_type）。 */
const MSG_TYPE_IMAGE = 3;

/** 精华消息项 OB11 结构。 */
export interface EssenceMsgInfo {
    msg_seq: number;
    msg_random: number;
    sender_id: number;
    sender_nick: string;
    operator_id: number;
    operator_nick: string;
    operator_time: number;
    message_id: number;
    content: OB11MessageSegment[];
}

/** 获取群精华消息列表（P2-15 接 kernel WebApi）。 */
export class GetEssenceMsgListAction extends BaseAction<
    GetEssenceMsgListPayload,
    EssenceMsgInfo[]
> {
    readonly name = "get_essence_msg_list";
    readonly schema = getEssenceMsgListSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly webApi: WebApi;

    constructor(webApi: WebApi) {
        super();
        this.webApi = webApi;
    }

    protected async _handle(payload: GetEssenceMsgListPayload): Promise<EssenceMsgInfo[]> {
        const list = await this.webApi.getEssenceMsgList(String(payload.group_id));
        const out: EssenceMsgInfo[] = [];
        for (const item of list) {
            const content: OB11MessageSegment[] = [];
            for (const part of item.msg_content ?? []) {
                const seg = toSegment(part);
                if (seg !== null) {
                    content.push(seg);
                }
            }
            out.push({
                msg_seq: item.msg_seq,
                msg_random: item.msg_random,
                sender_id: Number(item.sender_uin),
                sender_nick: item.sender_nick,
                operator_id: Number(item.add_digest_uin),
                operator_nick: item.add_digest_nick,
                operator_time: item.add_digest_time,
                message_id: 0,
                content,
            });
        }
        return out;
    }
}

/** msg_content 项 → OB11 段（1=text 3=image，纯函数）。 */
function toSegment(part: {
    msg_type?: number;
    text?: string;
    image_url?: string;
}): OB11MessageSegment | null {
    if (part.msg_type === MSG_TYPE_TEXT) {
        return { type: "text", data: { text: part.text ?? "" } };
    }
    if (part.msg_type === MSG_TYPE_IMAGE) {
        return { type: "image", data: { file: part.image_url ?? "" } };
    }
    return null;
}
