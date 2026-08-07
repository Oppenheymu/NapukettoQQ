/**
 * create-napukettoqq 脚手架核心：模板 + 目标目录创建 + 文件写入。
 *
 * 零依赖（仅 node:fs/promises / node:os / node:path / node:process），
 * 一次性工具保持自包含。生成的用户项目依赖发布版的 @napuketto/cli，
 * 用户 install 后经 cli → loader 自建宿主启动。
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** 生成的用户项目所依赖的 @napuketto/cli 版本范围（发布新版时统一改）。 */
export const CLI_VERSION = "^0.0.1";

/** 默认部署文件夹名（用户交互回车缺省值）。 */
export const DEFAULT_PROJECT_NAME = "NapukettoQQ";

/** Windows 路径非法字符（项目文件夹名校验用）。 */
const ILLEGAL_NAME = /[\\/:*?"<>|]/;

/** 脚手架生成结果。 */
export interface ScaffoldResult {
    /** 目标目录绝对路径。 */
    dir: string;
    /** 派生出的 npm 包名（小写、空格 → -）。 */
    packageName: string;
}

/** 校验文件夹名：非空、非 . / ..、不含 Windows 非法字符。 */
export function validateProjectName(raw: string): string {
    const name = raw.trim();
    if (name === "" || name === "." || name === "..") {
        throw new Error("文件夹名不能为空或为 . / ..");
    }
    if (ILLEGAL_NAME.test(name)) {
        throw new Error(`文件夹名含非法字符：${name}（不允许 \\ / : * ? " < > |）`);
    }
    return name;
}

/** 由文件夹名派生 npm 包名（小写、空格 → -）。 */
export function derivePackageName(dirName: string): string {
    return dirName.toLowerCase().replace(/\s+/g, "-");
}

/** 生成 package.json（用户项目，JSON.stringify 保证合法）。 */
function packageJsonTemplate(packageName: string): string {
    const pkg = {
        name: packageName,
        version: "0.0.1",
        private: true,
        type: "module",
        description: "NapukettoQQ 机器人项目（OneBot 11）",
        scripts: {
            start: "napuketto",
        },
        dependencies: {
            "@napuketto/cli": CLI_VERSION,
        },
    };
    return `${JSON.stringify(pkg, null, 4)}\n`;
}

/**
 * 生成 napuketto.toml：与 cli configTemplate（apps/cli/src/config-cmds.ts）同款内容，
 * dataDir 按当前用户主目录插值（JSON.stringify 转义反斜杠 → TOML 基本字符串合法写法）。
 */
function tomlTemplate(): string {
    const dataDirLiteral = JSON.stringify(path.join(homedir(), ".napuketto"));
    return `# ============================================================
# NapukettoQQ 全局配置文件（由 create-napukettoqq 生成）
# ============================================================
# 本文件与项目 napuketto.toml.example 内容一致（参考模板）。
# 数据（账号目录/日志/缓存/QQ 数据）不在此文件，按数据根组织：
#   优先级：--data-dir <dir> > NAPKETTO_DATA 环境变量 > ~/.napuketto
# 配置文件路径解析：NAPKETTO_CONFIG > 项目根探测 > cwd > 数据根兜底。
#
# 单账号启动每次读取本文件；修改后重启生效。

# ------------------------------------------------------------
# 基础配置
# ------------------------------------------------------------

# 数据根目录：账号目录/日志/缓存/QQ 数据存放位置（绝对路径）
dataDir = ${dataDirLiteral}

# 多账号（supervisor）模式下，账号进程崩溃是否自动重启
autoRestart = true

# 崩溃后自动重启的延迟（毫秒）
restartDelayMs = 2000

# 多账号列表（留空 = 单账号模式：启动后自动快速登录/扫码）
# [[accounts]]
# qq = "123456"          # QQ 号（必填）
# enabled = true         # 是否启用（可选，缺省 true）

# ------------------------------------------------------------
# OneBot 11 协议段
# ------------------------------------------------------------
[onebot11]

# 鉴权 token（全局默认）：HTTP/WS 连接必须携带。
#   校验方式：Authorization: Bearer <token> / 裸 token / URL 参数 ?access_token=<token>
#   每个网络实例可单独覆盖（见下文各实例的 token 字段）。
#   留空 = 不鉴权（仅本机调试推荐）。
# token = ""

# 心跳 meta 事件间隔（毫秒）；0 = 关闭心跳事件
heartbeatInterval = 3000

# 是否上报机器人自己发的消息（OB11 规范默认不上报）
reportSelfMessage = false

# 消息内容格式：array = 消息段数组（标准 OneBot 11），string = CQ 码字符串
messagePostFormat = "array"

# ---- HTTP 反向服务器（接收第三方 POST 指令），可配置多个 ----
[[onebot11.httpServers]]
enabled = true
host = "127.0.0.1"       # 监听地址；0.0.0.0 = 监听所有网卡（局域网可连）
port = 3000
# token = "abc"          # 可选：覆盖全局 token

# ---- HTTP 正向上报（Webhook：把事件 POST 到第三方地址），可配置多个 ----
# [[onebot11.httpPostUrls]]
# enabled = true
# url = "http://127.0.0.1:8080/onebot"   # 第三方接收地址
# token = "abc"                          # 可选：覆盖全局 token
# timeoutMs = 5000                       # 可选：上报超时（毫秒），缺省不超时

# ---- WS 反向服务器（外部 WS 客户端主动连入），可配置多个 ----
[[onebot11.wsServers]]
enabled = true
host = "127.0.0.1"
port = 3001
# token = "abc"                          # 可选：覆盖全局 token
# heartbeatInterval = 30000              # 可选：WS ping 间隔（毫秒）

# ---- WS 正向客户端（主动连接外部 WS，双向），可配置多个 ----
# [[onebot11.wsReverseUrls]]
# enabled = true
# url = "ws://127.0.0.1:8081/ws"         # 第三方 WS 地址（ws:// 或 wss://）
# token = "abc"                          # 可选：覆盖全局 token
# reconnectDelayMs = 5000                # 可选：断线重连延迟（毫秒）
# maxReconnectAttempts = 10              # 可选：最大重连次数（缺省无限）
# rejectUnauthorized = true              # 可选：wss:// 是否校验证书（自签证书设 false）
# heartbeatInterval = 30000              # 可选：WS ping 间隔（毫秒）
`;
}

/** 生成 readme.md（用户项目使用说明）。 */
function readmeTemplate(dirName: string): string {
    return `# ${dirName}

基于 **NapukettoQQ** 的 QQ 机器人项目（OneBot 11 协议），由 \`create-napukettoqq\` 生成。

## 快速开始

\`\`\`bash
pnpm install
pnpm start -q 123456        # 换成你的 QQ 号
\`\`\`

启动后按终端提示快速登录或扫码；登录成功后 OneBot 11 接口生效
（默认 HTTP \`127.0.0.1:3000\` + WS \`127.0.0.1:3001\`，见 \`napuketto.toml\`）。

## 前置要求

- 已安装 **QQ NT**（Windows，机器人所需的 \`wrapper.node\` 来自 QQ 安装目录，
  未自动探测到时用 \`pnpm start --qq-path <QQ安装目录>\` 指定）
- Node.js 20+ 与 pnpm

## 常用命令

| 命令 | 说明 |
|---|---|
| \`pnpm start -q <QQ号>\` | 单账号启动（走自建宿主） |
| \`pnpm napuketto config init\` | 重新生成默认配置 |
| \`pnpm napuketto supervisor\` | 多账号模式（按 \`napuketto.toml\` 的 \`accounts\`） |

## 目录

- \`napuketto.toml\` — 全局配置（QQ 号、OneBot 端口、token 等，修改后重启生效）
- QQ 数据（账号目录/日志/缓存）默认在 \`~/.napuketto/\`

## 升级

\`\`\`bash
pnpm update @napuketto/cli
\`\`\`
`;
}

/** 生成 .gitignore（用户项目）。 */
const GITIGNORE = `node_modules/
dist/
*.log
napuketto-data/
`;

/**
 * 生成 NapukettoQQ 项目骨架到当前目录下的 <dirName>/。
 * 目标目录已存在且非空 → 抛错（提示换名字或先清空）。
 */
export async function scaffoldProject(dirName: string): Promise<ScaffoldResult> {
    const name = validateProjectName(dirName);
    const packageName = derivePackageName(name);
    const dir = path.resolve(process.cwd(), name);

    // 目录已存在且非空 → 拒绝（避免覆盖用户文件）
    let existing: string[] = [];
    try {
        existing = await readdir(dir);
    } catch {
        // 目录不存在，可直接创建
    }
    if (existing.length > 0) {
        throw new Error(`目录已存在且非空：${dir}\n请换一个文件夹名，或先清空该目录。`);
    }

    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "package.json"), packageJsonTemplate(packageName), "utf8");
    await writeFile(path.join(dir, "napuketto.toml"), tomlTemplate(), "utf8");
    await writeFile(path.join(dir, "readme.md"), readmeTemplate(name), "utf8");
    await writeFile(path.join(dir, ".gitignore"), GITIGNORE, "utf8");

    return { dir, packageName };
}
