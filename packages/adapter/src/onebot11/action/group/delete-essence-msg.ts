/**
 * delete_essence_msg 动作：取消精华消息（P2-10 接 kernel GroupApi.removeGroupEssence）
 */

import { z } from "zod";
import { EssenceMsgBase } from "./set-essence-msg.js";

const deleteEssenceMsgSchema = z.object({
    message_id: z.union([z.number(), z.string()]),
});

/** 取消精华消息（P2-10 接 kernel removeGroupEssence）。 */
export class DeleteEssenceMsgAction extends EssenceMsgBase {
    readonly name = "delete_essence_msg";
    readonly schema = deleteEssenceMsgSchema;

    protected async operate(groupCode: string, msgId: string): Promise<void> {
        await this.deps.groupApi.removeGroupEssence(groupCode, msgId);
    }
}
