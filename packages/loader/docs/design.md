# @napuketto/loader 设计（v2：跨平台 + 无本机 QQ 运行）

> **状态**：设计稿（2026-08-12）。配套主仓库 `docs/STATUS.md` / `docs/architecture.md`。
> 设计先行——本文件定稿后再实现，实现顺序见 §7。
>
> **用户拍板（2026-08-12，含技术栈逐条确认）**：
> 1. **绝不内置腾讯二进制**——wrapper.node / QQNT.dll / 官方安装包都不得进入 npm 包、Docker 镜像或任何发布产物；文件必须在用户机器上运行时获取。
> 2. **只接受方案 a**（wine 跑 Windows 版 node.exe + stub + dlopen wrapper.node），不接受方案 b（wine 跑完整 QQ NT）。
> 3. **架构事实确认**：整个业务栈（kernel + adapter + network + cli）都在 wine 内跑 Windows node.exe，对外只暴露**无状态的标准 OneBot11/Satori 网络协议端口（localhost）**——高内聚低耦合，符合云原生微服务理念。
> 4. **wine 版本 = wine-stable**（或发行版默认）；Docker 内仅 `wine64`（省 100MB+ 镜像体积）。不追新：QQNT 核心不依赖 wine-devel 特性，稳定优先防 regression。
> 5. **路径映射确认**：launcher 层必须做 Linux 路径 → wine `Z:\` 路径转换（`toWinePath`），写入 §3.2。
> 6. **版本清单自动化立项**：探测腾讯公开版本接口/官方下载页，有则 CI 自动更新，无则人肉维护 + `NAPUTO_QQ_URL` 兜底。**2026-08-12 实测：官方下载页可爬，探测方案可行**（见 §2.2）。
> 7. **下载实现 = Node 内置 `https` + `crypto`**（无第三方依赖，轻依赖即美德）。
> 8. **解包工具 = 内置 `7za.exe`**（LGPL 可分发，Windows 纯净环境兜底）+ Linux/Docker 用系统 `p7zip-full`。
> 9. **ARM = 第一版只承诺 `linux/amd64`**，ARM（M1/M2/树莓派）列为后置 P2/P3。
> 10. **DPAPI/票据持久化**：wine 的 DPAPI 用随机本地密钥模拟——**wine 容器/`WINEPREFIX` 被销毁则登录状态丢失**，需提示用户持久化哪些路径（见 §6）。
> 11. **反风控为核心风险**：P2 阶段立刻推进快速登录/扫码登录冒烟测试，尽早试探腾讯风控对 wine 环境的容忍度。
>
> **发布形态（2026-08-13 补充：对外 API 双格式）**：
> - 对外 API（`dist/index.mjs` + `dist/index.cjs`）与 kernel 同步输出 **ESM + CJS 双格式**，
>   `exports.require` 指向 `.cjs`——koishi 适配器（发布形态为 `lib/index.cjs`，koishi loader
>   用 `require()` 加载）require 本包时不再 `ERR_REQUIRE_ESM`；ESM 消费方（apps/cli）走 `import`。
> - `import.meta.url`（launcher/qq-extract/qq-releases 定位包内资产）由 rolldown 在 CJS 输出中
>   转换为 `pathToFileURL(__filename)` 等价形式，`dist/` 下相对定位行为不变。
> - `host/self-host.cjs`（CJS 单文件 bundle，子进程入口）不受影响。

---

## 1. 背景与目标

### 1.1 现状约束

- 自建宿主（路线 A）是唯一实现方式：标准 Node + stub QQNT.dll 转发 → `process.dlopen(wrapper.node)`。
- 当前 `locate-qq.ts` 只支持 **Windows 本机已装 QQ** 的场景：注册表 / 常见路径 / `NAPUTO_QQ_PATH`，找不到就抛错。
- stub QQNT.dll 是 **PE 格式**，Linux 加载器不认 → Linux 上必须靠 wine 的 PE 加载能力。

### 1.2 三个目标

| # | 目标 | 解决的问题 |
|---|---|---|
| G1 | **本机无 QQ 也能运行** | 用户机器没装 QQ NT（或装了但被卸载），无需手动安装 |
| G2 | **Linux 支持（方案 a）** | 服务器 / 无 GUI 环境跑机器人 |
| G3 | **Docker 镜像**（⚠️ 未实现/规划） | 一键部署，`docker run` 即用 |

### 1.3 硬约束（违反 = 错误）

1. **不内置腾讯二进制**：所有发布产物（npm 包 / Docker 镜像 / 仓库文件）不得包含
   `wrapper.node`、`QQNT.dll`、官方安装包 `.exe`、`major.node` 等腾讯文件（含压缩/编码形式）。
2. **不内置 NapCat 代码**（GPL-2.0-only 与 MIT 不兼容，AGENTS.md 红线不变）。
3. **只接受 wine 方案 a**：Linux 上 = wine 跑 Windows 版 node.exe + stub + dlopen wrapper.node，
   不跑完整 QQ 客户端。
4. **零磁盘篡改**（AGENTS.md 第 7 条不变）：只读加载，不改写任何腾讯文件。
5. 业务层优先 NAPI，逆向手段仅限 loader 载具层（不变）。

---

## 2. G1：QQ 文件来源解耦（本机无 QQ 也能跑）

### 2.1 核心思路

把「QQ 文件从哪来」从「必须本机安装」扩展为**多级来源探测 + 自动下载解包**：

```
resolveQqFiles()   ← 替代现有 resolveQqInstall() 的文件定位部分
  ├─ L0: NAPUTO_QQ_FILES 环境变量（显式指定含 versions/ 结构的目录）
  ├─ L1: 本机 QQ 安装（现有逻辑：注册表 / 常见路径 / NAPUTO_QQ_PATH）
  ├─ L2: 数据根缓存 <数据根>/qq-files/<版本>/（下载解包产物）
  └─ 全部缺失 → 自动进入「下载 → 解包 → 缓存」流程，再走 L2
```

- **版本选择策略**：L0/L1 有版本就用本机版本；否则按「版本清单」中**最新已知可用版本**下载。
- **幂等**：缓存目录已有目标版本 → 跳过下载，直接使用。

### 2.2 官方安装包下载器

**链接结构（用户提供的事实）**：

```
https://qqdl.gtimg.cn/qqfile/QQNT/9.9.33/release/a0ce07ad/QQ_9.9.33_260730_x64_01.exe
        └─ 主域固定      └─ 版本号  └─ release  └─ 哈希(随版本变)  └─ QQ_<版本>_<构建日期>_x64_01.exe
```

**版本探测（2026-08-12 实测结论）**：

- ❌ 无公开 JSON 版本接口：`dldir1.qq.com/qqfile/qq/QQNT/version.json` 等候选均 404。
- ✅ **官方下载页可爬**（GitOps 自动化的基础）：
  - `https://im.qq.com/qq/download/`（官方首页下载入口，HTML 内含最新版链接）
  - `https://im.qq.com/index/#/windows`（版本列表页，HTML 内含 64 位/32 位/ARM 三变体链接 + 版本号 + 构建日期）
  - 实测抓到的链接与用户给的一致：`QQ_9.9.33_260730_x64_01.exe`。
  - 两页均为**纯 HTML 含链接**（非 JS 渲染），可直接 `https` GET + 正则提取。
- **CI 自动更新方案（GitHub Actions）**：
  - Cron Job（如每日）抓取上述两页 → 正则提取最新版 URL + 版本号 + 日期；
  - 与 `qq-releases.json` 比对，发现新版本 → 自动提 PR 更新清单（GitOps 免维护）。

**版本清单机制（qq-releases.json）**：

- 仓库维护 `packages/loader/qq-releases.json`（**纯文本元数据，非二进制**，符合硬约束 1）：

```json
{
    "schema": 1,
    "known": [
        {
            "version": "9.9.33-51802",
            "url": "https://qqdl.gtimg.cn/qqfile/QQNT/9.9.33/release/a0ce07ad/QQ_9.9.33_260730_x64_01.exe",
            "sha256": "…（CI 下载后计算填入）",
            "appid": 537376818,
            "source": "official"
        }
    ]
}
```

- **清单更新方式**（三级兜底）：
  1. **CI 自动**：GitHub Actions 爬官方下载页 → 新版本自动 PR；
  2. **配置/环境变量 `NAPUTO_QQ_URL` 直接覆盖**下载地址（用户自己拿到新链接时用）；
  3. **社区 PR** 手动更新仓库内 `qq-releases.json`。
- **sha256 校验**：下载完成后校验，防链接漂移被劫持 + 防下载不完整。
  （注：`appid` 仍按现有逻辑从 `major.node` 运行时解析，清单里的 appid 仅作预知信息。）

### 2.3 解包提取

- **安装包格式**：QQ NT 官方安装包是 NSIS 自解压格式，可用完整版 7-Zip 解包（`7z x`）。
  **⚠️ 2026-08-12 实测修正：`7za` standalone 不支持 NSIS**（只支持 7z/zip/tar 等），
  必须完整版 `7z.exe` + `7z.dll`（已内置 assets/7zip，LGPL 合规）。
- **NSIS 解包布局**：解包产物在 `<extracted>/Files/`（NSIS 内部布局），`Files/` = 安装根。
- **解包工具来源**：
  - Windows：内置 `assets/7zip/7z.exe + 7z.dll`（7-Zip 官方 26.02，LGPL 可随包分发）；
  - Linux/Docker：系统 `p7zip-full`（7z 完整版）。
- **⚠️ 2026-08-12 实测修正：真实 QQNT.dll（214MB）不需要提取**——它在
  `versions/<v>/QQNT.dll`，但自建宿主中 stub QQNT.dll 已替代其宿主符号职责
  （wrapper.node 的 v8/node/napi/qq_magic 符号由 stub 转发到 node.exe）。
- **提取目标（2026-08-12 实测修正，最小集）**：resources/app **顶层全部 `*.node` + `*.dll`**
  （wrapper.node 的直接/传递/delay-load 依赖全覆盖，版本无关；跳过 wmpfsdk/avsdk 等
  大子目录，约 235MB）：

```
<数据根>/qq-files/<版本>/versions/<版本>/resources/app/
└── wrapper.node / major.node / *.dll（libvips-42 / libglib-2.0-0 / crypto / …）
```

- **提取产物校验**：`wrapper.node` 存在 + 目录结构完整（dlopen 冒烟由 launcher 启动流程天然覆盖）。

### 2.4 与现有 locate-qq.ts 的关系

- `locate-qq.ts` 保留本机探测逻辑（L1），新增：
  - `resolveQqFiles()`（多级来源统一入口，**P1 起为 async**——自动下载是异步流程）；
  - `ensureQqFiles()`（下载 + 解包 + 校验 + 缓存，幂等：缓存命中直接返回）。
- `QqInstallInfo` 扩展：`source: "local" | "cached"`，`wrapperPath` 定位逻辑复用。

---

## 3. G2：Linux 支持（方案 a：wine + Windows node.exe）

### 3.1 形态

```
Linux 主机（无 QQ 安装）
  └─ wine（系统包，模拟 Windows PE 加载）
       └─ Windows 版 node.exe（从 nodejs.org 官方下载，非腾讯二进制）
            └─ 标准 Node 自建宿主链路（与 Windows 完全一致）：
               PATH 前置 stub 目录 + wrapper.node 目录
               → process.dlopen(wrapper.node)
               → O3MiscService 激活 → 登录 → session READY → 协议装配
```

- **Windows 版 node.exe 来源**：`https://nodejs.org/dist/<版本>/node-v<版本>-win-x64.zip`（Node 官方，非腾讯）。
  与腾讯二进制不同——这是**开源软件官方发行版**，但为保守起见同样**不内置**，运行时自动下载到
  `<数据根>/runtime/win-node/`（可被 `NAPUTO_WIN_NODE_PATH` 覆盖）。
- **wine 来源**：Linux 用户用系统包管理器安装（`apt install wine` 等）；Docker 镜像内预装（G3）。

### 3.2 launcher 的平台分支

```ts
// launcher.ts：spawn 命令平台分支
const nodeBin = process.platform === "win32"
    ? process.execPath                                    // Windows：本机 node
    : await ensureWinNode();                              // Linux：wine + win node.exe
// spawn 参数：
//   win32: [selfHostPath]
//   linux: ["wine", winNodePath, selfHostPath]
```

- PATH 装配逻辑**不变**（stub 目录 + wrapper.node 目录前置），wine 会把这些目录当作 Windows PATH 解析。
- 环境变量透传逻辑不变（`buildLaunchEnv` 复用）。

**路径映射（toWinePath，2026-08-12 拍板确认）**：

Windows 版 node.exe 在 wine 内把整个 Linux 根目录挂载在 `Z:\`。`process.dlopen` 收到的是 wine 视角的 Windows 路径，而现有代码里 `wrapperPath` / stub 目录 / cfgDir 都是 Linux 路径。launcher 层必须做转换：

```ts
// launcher.ts 内部：Linux 路径 → wine Z:\ 路径
function toWinePath(linuxPath: string): string {
    // 例：/app/.napuketto/qq-files/9.9.33/wrapper.node → Z:\app\.napuketto\qq-files\9.9.33\wrapper.node
    // 注意反斜杠转义 + 去除前导 /；wine 自动把 Z:\ 映射到 Linux 根目录
    return "Z:\\" + linuxPath.replaceAll("/", "\\").replace(/^\\/, "");
}
```

- **用途**：`NAPUTO_WRAPPER_PATH` / `NAPUTO_CFG_DIR` / stub 目录 / self-host.cjs 路径等**所有传给 wine 子进程的环境变量与参数**都要过 `toWinePath`。
- **实现位置**：launcher.ts（高内聚，单独纯函数可单测）。

### 3.3 关键验证点（2026-08-12 WSL2 实测，全绿）

| 验证点 | 结果 | 实测记录 |
|---|---|---|---|
| wine 跑 Windows node.exe | ✅ **通过** | `wine node.exe -e "..."` → `win-node-ok x64 v24.16.0`（process.arch=x64 证明 PE 二进制） |
| stub QQNT.dll PE Export Forwarding 生效 | ✅ **通过** | wine 下 dlopen wrapper.node → **98 exports**（NodeIQQNTWrapperEngine / NodeIKernelLoginService 全在） |
| wine 下 dlopen wrapper.node | ✅ **通过** | `const m={exports:{}}; process.dlopen(m, wrapper.node)` → 98 exports |
| 登录 + session READY | ⏳ 待测（Step 2：完整 self-host 登录冒烟） | 需要账号 + 快速登录/扫码 |
| 无头 | ✅ 自建宿主本就不依赖 UI | wine 无窗口跑 |

**⚠️ 实测坑（必须记住）**：wine 读 **DrvFS（/mnt/c）会 "File not found"**（文件在 Linux 侧 `ls` 正常，但 wine `dir` 看不到）——
**QQ 文件必须放 ext4 文件系统**（WSL 原生 `~/...`）。验证过程：复制到 `~/.qqfiles/`（ext4）后 wine 正常读取。
这正是设计里「数据根/qq-files 缓存」放 Linux 原生路径的实证。**Docker 场景无此问题**（容器内天然 ext4）。

**dlopen 参数形态（实测）**：`const m = { exports: {} }; process.dlopen(m, wrapper.node)`——
直接传 `{ exports: {} }` 字面量会报 `Cannot convert undefined or null to object`（wrapper 需要 module 对象载体）。

> 若冒烟发现某个环节 wine 不支持（理论风险低），回退手段：该环节改用 wine 的
> `winedbg`/调试工具定位；不切换方案 b（用户拍板）。

---

## 4. G3：Docker 镜像

### 4.1 镜像设计（不内置腾讯二进制）—— ⚠️ 未实现/规划（全仓库无 Dockerfile / docker/ 目录）

```
Dockerfile.linux
  FROM node:22-slim（仅 wine64，不装 wine32，省 100MB+）
  RUN apt-get install -y wine64 p7zip-full   # wine64 + 解包工具（wine-stable）
  COPY 自研代码（dist 产物 + stub QQNT.dll）   # 注意：stub 是自研，可内置
  COPY entrypoint.sh
  VOLUME /app/.napuketto                       # 数据卷：账号数据 + qq-files 缓存 + win-node
  VOLUME /app/.wine                           # WINEPREFIX（DPAPI 票据持久化，见 §6）
  ENV NAPUTO_DATA=/app/.napuketto
  ENV WINEPREFIX=/app/.wine
  ENTRYPOINT ["/app/entrypoint.sh"]
```

**平台支持（2026-08-12 拍板）**：第一版只承诺 `linux/amd64`；ARM（M1/M2 Mac、树莓派）需 QEMU 用户态模拟，性能损耗大且易段错误，列为后置 P2/P3。

**entrypoint.sh 职责**（首次启动自动准备，无腾讯二进制进镜像）：

```
1. 确保 Windows 版 node.exe（下载 nodejs.org 官方 zip → 解压到数据卷）
2. 确保 QQ 文件缓存（按版本清单下载官方安装包 → 7z 解包 → 提取 wrapper.node 等）
3. 确保 WINEPREFIX 初始化（wineboot；DPAPI 密钥生成并持久化在数据卷）
4. 执行 self-host（wine node.exe …）
```

### 4.2 使用形态

```bash
# 构建
docker build -f Dockerfile.linux -t napuketto/qq .

# 运行（数据卷持久化：QQ 文件缓存只下载一次）
docker run -d \
  -v napuketto-data:/app/.napuketto \
  -p 8080:8080 \
  napuketto/qq --config /app/.napuketto/napuketto.toml
```

- 首次启动较慢（下载 QQ 安装包 + win-node），后续启动秒级。
- 数据卷必须挂载，否则每次重建容器都重新下载。

---

## 5. 文件与模块划分（改动集中 loader 包）

```
packages/loader/
├── qq-releases.json          # 新增：版本清单（URL + sha256 + appid，纯文本）
├── src/
│   ├── locate-qq.ts          # 改：保留 L1 本机探测；新增 resolveQqFiles/ensureQqFiles
│   ├── qq-download.ts        # 新增：官方安装包下载（https + sha256 校验 + 断点续传可选）
│   ├── qq-extract.ts         # 新增：7z 解包 + 提取 wrapper.node/QQNT.dll/major.node
│   ├── win-node.ts           # 新增：Windows 版 node.exe 获取（下载/解压/缓存/覆盖）
│   ├── launcher.ts           # 改：spawn 平台分支（win32 / wine）
│   └── index.ts              # 改：导出新模块
├── Dockerfile.linux          # 新增（仓库根或 loader 包内）
├── docker/entrypoint.sh      # 新增
└── docs/design.md            # 本文件
```

**依赖**：loader 现有依赖不变（无新增运行时 npm 依赖）；`qq-download.ts` 用 Node 内置
`https`/`crypto`（sha256）实现，不引第三方（与「无内部依赖」风格一致）。

---

## 6. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| 官方链接漂移（腾讯改 URL/下线版本） | 🟡 中 | **CI 自动爬官方下载页**（§2.2）+ `NAPUTO_QQ_URL` 覆盖；错误信息明确提示去更新清单 |
| wine 下某个环节不兼容（理论低） | 🟡 低 | §3.3 冒烟验证点前置；不切换方案 b（用户拍板） |
| **DPAPI 票据丢失**（隐形炸弹） | 🟡 中 | wine 的 `CryptProtectData` 用随机本地密钥模拟——**wine 容器 / WINEPREFIX 被销毁则登录状态必然丢失**。对策：① Docker 挂载 `WINEPREFIX` 数据卷（§4.1）；② 文档明确告知用户需持久化哪些路径（`.wine` / `.napuketto`）；③ 快速登录票据存 kernel 数据根，同样随数据卷持久化 |
| **反风控环境特征（核心风险）** | 🔴 高 | wine 内注册表结构 / MAC / 硬盘序列号特征单一。对策：**P2 阶段立刻做快速登录/扫码登录冒烟测试**，尽早试探腾讯风控对 wine 的容忍度；失败则评估进程名伪装/环境模拟（loader 载具层） |
| v8 JIT + wine 兼容 | 🟢 低 | Electron 体系跑 wine 已有先例（VS Code/Discord）；只要 wrapper.node 不重度依赖未公开 Windows API 即可 |
| 首次下载慢 / 网络被墙 | 🟡 中 | sha256 校验保证完整性；`NAPUTO_QQ_FILES` 支持预置目录（用户手动拷贝绕过下载） |
| 镜像体积大（wine ~1GB） | 🟢 低 | `node:22-slim` + `wine64`（省 100MB+）；QQ 文件放数据卷不进镜像 |
| ARM 模拟性能（后置） | 🟢 低 | 第一版只承诺 amd64；ARM 列为 P2/P3 |

---

## 7. 实现顺序（设计先行，逐模块推进）

> 每个模块完成跑一次 `pnpm check`。

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0** ✅ | `locate-qq.ts` 多级来源 + `resolveQqFiles`（L0/L1/L2 纯定位，不下载） | Windows 本机路径回归不破 |
| **P1** ✅ | `qq-releases.json` + `qq-download.ts` + `qq-extract.ts`（下载→校验→解包→缓存） | Windows 上删掉本机 QQ 探测也能跑起来（用缓存） |
| **P2** ✅ | `win-node.ts` + `launcher.ts` 平台分支 | Linux 冒烟：wine node.exe → dlopen wrapper.node（登录 + session READY 待测） |
| **P3** ⏳ | Dockerfile + entrypoint + 文档（**未实现**） | `docker run` 全链路跑通（数据卷持久化验证） |

---

## 8. 已拍板细节（2026-08-12 技术栈讨论结论）

1. **wine 版本**：`wine-stable`（发行版默认）；Docker 仅 `wine64`。
2. **路径映射**：`toWinePath` 纯函数入 launcher（§3.2），所有传给 wine 子进程的路径过转换。
3. **版本探测**：已立项，实测官方下载页可爬（§2.2），CI Cron 自动更新清单。
4. **下载实现**：Node 内置 `https` + `crypto`（sha256），无第三方依赖。
5. **解包工具**：内置 `7za.exe`（LGPL 合规可分发）+ Linux/Docker 系统 `p7zip-full`。
6. **ARM**：第一版只承诺 `linux/amd64`，ARM 列后置 P2/P3。
7. **DPAPI**：WINEPREFIX 必须随数据卷持久化（§4.1/§6），文档明确持久化路径。
8. **反风控**：P2 阶段第一优先 = 快速登录/扫码登录冒烟测试。

**遗留待实现时确认**：
1. `qq-releases.json` 放 loader 包内 vs 单独维护（先放包内，后续量大再拆）。
2. `resolveQqInstall` 的 API 兼容：保留旧签名导出，新入口 `resolveQqFiles` 并行存在，待 cli/koishi 适配器切换后再移除旧入口。
