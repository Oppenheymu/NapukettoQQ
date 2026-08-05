/**
 * can_send_record 动作：是否可以发送语音（本地 true，P2-11）
 */

import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const canSendRecordSchema = z.object({});

type CanSendRecordPayload = z.infer<typeof canSendRecordSchema>;

/** 是否可以发送语音（本地 true，P2-11）。 */
export class CanSendRecordAction extends BaseAction<CanSendRecordPayload, { yes: boolean }> {
    readonly name = "can_send_record";
    readonly schema = canSendRecordSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    protected _handle(_payload: CanSendRecordPayload): Promise<{ yes: boolean }> {
        return Promise.resolve({ yes: true });
    }
}
