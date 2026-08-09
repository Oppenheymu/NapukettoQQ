/**
 * Satori 类型出口（资源 + 事件 + 分页）。
 */

// 纯类型：显式类型导出
export type {
    BidiList,
    List,
    SatoriAction,
} from "./api.js";
export { Direction, Order } from "./api.js";
export type {
    Argv,
    Button,
    Event,
    IdentifyBody,
    MetaBody,
    ReadyBody,
    Signal,
} from "./event.js";
export { Opcode } from "./event.js";
export type {
    Channel,
    Emoji,
    Friend,
    Guild,
    GuildMember,
    GuildRole,
    Login,
    Message,
    User,
} from "./resource.js";
// 值 + 同名类型（const 对象 + typeof 收窄）：显式导出值（类型随值一并导出）
export { ChannelType, LoginStatus } from "./resource.js";
