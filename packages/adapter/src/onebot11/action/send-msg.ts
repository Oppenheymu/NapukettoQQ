/**
 * send_msg 动作：发送消息（群聊/私聊）
 *
 * 当前为骨架实现：zod 校验 + 占位 kernel 调用（P2 与 kernel apis/msg 打通后替换）。
 * 消息参数兼容 CQ 码字符串与 segment 数组两种格式。
 */

import { z } from "zod";
import { BaseAction } from "../../core/index.js";
import { ob11ErrorCodeMap } from "./error-map.js";

const sendMsgSchema = z.object({
    message_type: z.enum(["group", "private"]).optional(),
    user_id: z.number().optional(),
    group_id: z.number().optional(),
    message: z.union([z.string(), z.array(z.unknown())]),
    auto_escape: z.boolean().optional(),
});

type SendMsgPayload = z.infer<typeof sendMsgSchema>;

/** 发送消息（P2 打通 kernel apis/msg 后返回真实 msgId）。 */
export class SendMsgAction extends BaseAction<SendMsgPayload, { message_id: number }> {
    readonly name = "send_msg";
    readonly schema = sendMsgSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    protected _handle(payload: SendMsgPayload): Promise<{ message_id: number }> {
        if (!(payload.group_id || payload.user_id)) {
            return Promise.reject(new Error("send_msg 需要 group_id 或 user_id"));
        }
        // TODO(P2): 调 kernel apis/msg.sendMessage（canonical 元素 → NT 发送）
        return Promise.resolve({ message_id: Date.now() });
    }
}
