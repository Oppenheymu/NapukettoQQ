/**
 * get_group_honor_info 动作：获取群荣誉信息（P2-15 接 kernel WebApi）
 *
 * qun.qq.com honorlist web 接口；type 缺省 all。
 */
import type { GroupHonorWebInfo, WebApi } from "@napuketto/kernel";
import { WebHonorType } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import { ob11ErrorCodeMap } from "../error-map.js";

const getGroupHonorInfoSchema = z.object({
    group_id: z.number(),
    type: z.string().optional(),
});

type GetGroupHonorInfoPayload = z.infer<typeof getGroupHonorInfoSchema>;

/** 获取群荣誉信息（P2-15 接 kernel WebApi）。 */
export class GetGroupHonorInfoAction extends BaseAction<
    GetGroupHonorInfoPayload,
    GroupHonorWebInfo
> {
    readonly name = "get_group_honor_info";
    readonly schema = getGroupHonorInfoSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly webApi: WebApi;

    constructor(webApi: WebApi) {
        super();
        this.webApi = webApi;
    }

    protected _handle(payload: GetGroupHonorInfoPayload): Promise<GroupHonorWebInfo> {
        const type = mapHonorType(payload.type);
        return this.webApi.getGroupHonorInfo(String(payload.group_id), type);
    }
}

/** type 字符串 → WebHonorType（talkative/performer/legend/emotion/all，纯函数）。 */
function mapHonorType(raw: string | undefined): WebHonorType {
    if (raw === "talkative") {
        return WebHonorType.TALKATIVE;
    }
    if (raw === "performer") {
        return WebHonorType.PERFORMER;
    }
    if (raw === "legend") {
        return WebHonorType.LEGEND;
    }
    if (raw === "emotion") {
        return WebHonorType.EMOTION;
    }
    return WebHonorType.ALL;
}
