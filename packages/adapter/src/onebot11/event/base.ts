/**
 * OneBot 11 事件基类（OB11 公开协议规范，自研描述）
 *
 * 所有事件共有的三个字段：time（Unix 秒）/ self_id（机器人 QQ 号）/ post_type（事件大类）。
 * 各事件类型通过 post_type + 二级判别字段（message_type/notice_type/request_type/meta_event_type）
 * 组成可判别联合，适配器广播与第三方框架消费都靠判别字段收窄。
 */

/** OB11 post_type（事件大类）。 */
export type OB11PostType = "message" | "notice" | "request" | "meta_event";

/** OB11 事件基类。 */
export interface OB11BaseEvent {
    /** 事件发生时间（Unix 秒）。 */
    time: number;
    /** 机器人自身 QQ 号。 */
    self_id: number;
    /** 事件大类。 */
    post_type: OB11PostType;
}
