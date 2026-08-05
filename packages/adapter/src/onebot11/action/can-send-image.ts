/**
 * can_send_image 动作：是否可以发送图片（本地 true，P2-11）
 */

import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const canSendImageSchema = z.object({});

type CanSendImagePayload = z.infer<typeof canSendImageSchema>;

/** 是否可以发送图片（本地 true，P2-11）。 */
export class CanSendImageAction extends BaseAction<CanSendImagePayload, { yes: boolean }> {
    readonly name = "can_send_image";
    readonly schema = canSendImageSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    protected _handle(_payload: CanSendImagePayload): Promise<{ yes: boolean }> {
        return Promise.resolve({ yes: true });
    }
}
