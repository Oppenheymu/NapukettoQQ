/** 资料类动作（P2-14）：set_self_longnick / set_qq_profile / set_qq_avatar
 */
import { existsSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ProfileApi } from "@napuketto/kernel";
import { z } from "zod";
import { BaseAction } from "../../../core/index.js";
import type { OneBotApi } from "../../api/one-bot-api.js";
import { ob11ErrorCodeMap } from "../error-map.js";

/** URL 前缀（头像在线文件识别）。 */
const URL_PREFIX = /^https?:\/\//;

const setSelfLongnickSchema = z.object({
    longNick: z.string(),
});

type SetSelfLongnickPayload = z.infer<typeof setSelfLongnickSchema>;

/** 设置个性签名（P2-14 接 kernel ProfileApi.setLongNick）。 */
export class SetSelfLongnickAction extends BaseAction<SetSelfLongnickPayload, null> {
    readonly name = "set_self_longnick";
    readonly schema = setSelfLongnickSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly profileApi: ProfileApi;

    constructor(profileApi: ProfileApi) {
        super();
        this.profileApi = profileApi;
    }

    protected async _handle(payload: SetSelfLongnickPayload): Promise<null> {
        await this.profileApi.setLongNick(payload.longNick);
        return null;
    }
}

const setQQProfileSchema = z.object({
    nickname: z.string(),
    personal_note: z.string().optional(),
    sex: z.union([z.number(), z.string()]).optional(),
});

type SetQQProfilePayload = z.infer<typeof setQQProfileSchema>;

/** 设置 QQ 资料（P2-14；nickname → setNickName，personal_note → setLongNick，sex 忽略）。 */
export class SetQQProfileAction extends BaseAction<SetQQProfilePayload, null> {
    readonly name = "set_qq_profile";
    readonly schema = setQQProfileSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly profileApi: ProfileApi;

    constructor(profileApi: ProfileApi) {
        super();
        this.profileApi = profileApi;
    }

    protected async _handle(payload: SetQQProfilePayload): Promise<null> {
        await this.profileApi.setNickName(payload.nickname);
        if (payload.personal_note !== undefined) {
            await this.profileApi.setLongNick(payload.personal_note);
        }
        return null;
    }
}

const setQQAvatarSchema = z.object({
    /** 本地路径（URL 需先下载，由装配方 cacheDir 支持）。 */
    file: z.string(),
});

type SetQQAvatarPayload = z.infer<typeof setQQAvatarSchema>;

/** 设置头像依赖（cacheDir 供 URL 下载，OneBotApi 视图）。 */
export type SetQQAvatarDeps = Pick<OneBotApi, "profileApi" | "cacheDir">;

/** 设置 QQ 头像（P2-14 接 kernel ProfileApi.setHeader）。 */
export class SetQQAvatarAction extends BaseAction<SetQQAvatarPayload, null> {
    readonly name = "set_qq_avatar";
    readonly schema = setQQAvatarSchema;
    protected readonly errorCodeMap = ob11ErrorCodeMap;

    private readonly deps: SetQQAvatarDeps;

    constructor(deps: SetQQAvatarDeps) {
        super();
        this.deps = deps;
    }

    protected async _handle(payload: SetQQAvatarPayload): Promise<null> {
        let filePath = payload.file;
        if (URL_PREFIX.test(filePath)) {
            filePath = await this.downloadToCache(filePath);
        }
        if (!existsSync(filePath)) {
            throw new Error(`头像文件不存在: ${filePath}`);
        }
        await this.deps.profileApi.setHeader(filePath);
        return null;
    }

    /** URL 下载到缓存目录（cacheDir 缺省抛错）。 */
    private async downloadToCache(url: string): Promise<string> {
        const { cacheDir } = this.deps;
        if (cacheDir === undefined || cacheDir === "") {
            throw new Error("set_qq_avatar 处理 URL 需要缓存目录（装配方未注入）");
        }
        const safeName = basename(new URL(url).pathname) || "avatar.bin";
        const filePath = join(cacheDir, `avatar-${Date.now()}-${safeName}`);
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`头像下载失败: ${res.status} ${res.statusText}`);
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        writeFileSync(filePath, buf);
        return filePath;
    }
}
