/**
 * OneBot 11 类型定义（自研描述，参考公开协议规范）
 * 对应 ADR-001：接口签名是外部协议事实，可自研描述，不复制实现。
 */

/** OB11 统一返回结构。 */
export interface OB11Return<T> {
    status: "ok" | "failed";
    retcode: number;
    data: T;
    message: string;
    echo?: unknown;
}

/** OB11 消息段（segment）。 */
export type OB11MessageSegment =
    | { type: "text"; data: { text: string } }
    | { type: "at"; data: { qq: string; name?: string } }
    | { type: "face"; data: { id: string } }
    | { type: "image"; data: { file: string; url?: string } }
    | { type: "record"; data: { file: string; url?: string } }
    | { type: "video"; data: { file: string; url?: string } }
    | { type: "reply"; data: { id: string } }
    | { type: "forward"; data: { id: string } }
    | { type: "json"; data: { data: string } }
    | { type: "xml"; data: { data: string } }
    | { type: "string"; data: { text: string } };

/** OB11 消息（segment 数组或 CQ 码字符串）。 */
export type OB11Message = string | OB11MessageSegment[];

/** 消息发送来源。 */
export interface Sender {
    user_id: number;
    nickname?: string;
    card?: string;
    role?: "owner" | "admin" | "member";
}

/** 群信息（get_group_info 返回）。 */
export interface GroupInfo {
    group_id: number;
    group_name: string;
    member_count?: number;
    max_member_count?: number;
}

/** 登录信息（get_login_info 返回）。 */
export interface LoginInfo {
    user_id: number;
    nickname: string;
}
