/**
 * OneBot 11 元事件（meta_event）：生命周期 / 心跳
 *
 * lifecycle 由适配器启停时广播（enable/disable/connect）；
 * heartbeat 按配置间隔定时广播，status 为运行状态（get_status 同构）。
 */

import type { OB11BaseEvent } from "./base.js";

/** 运行状态（get_status 返回 + 心跳 status，扩展字段透传）。 */
export interface OB11Status {
    online: boolean;
    good: boolean;
    [key: string]: unknown;
}

/** 生命周期事件（适配器 enable/disable/connect 时广播）。 */
export interface OB11LifecycleMetaEvent extends OB11BaseEvent {
    post_type: "meta_event";
    meta_event_type: "lifecycle";
    sub_type: "enable" | "disable" | "connect";
}

/** 心跳事件（按配置 interval 毫秒定时广播）。 */
export interface OB11HeartbeatMetaEvent extends OB11BaseEvent {
    post_type: "meta_event";
    meta_event_type: "heartbeat";
    /** 心跳间隔（毫秒）。 */
    interval: number;
    status: OB11Status;
}

/** OB11 元事件联合。 */
export type OB11MetaEvent = OB11LifecycleMetaEvent | OB11HeartbeatMetaEvent;
