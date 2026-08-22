# @napuketto/cli

## 0.1.5

### Patch Changes

- Updated dependencies [7e35821]
  - @napuketto/kernel@0.0.15
  - @napuketto/loader@0.0.22
  - @napuketto/adapter@0.0.18

## 0.1.4

### Patch Changes

- Updated dependencies [47bb6d2]
  - @napuketto/loader@0.0.21

## 0.1.3

### Patch Changes

- Updated dependencies [19baba2]
  - @napuketto/kernel@0.0.14
  - @napuketto/loader@0.0.20
  - @napuketto/adapter@0.0.17

## 0.1.2

### Patch Changes

- Updated dependencies
  - @napuketto/loader@0.0.19

## 0.1.1

### Patch Changes

- Updated dependencies [cd8a030]
- Updated dependencies [426cf43]
  - @napuketto/loader@0.0.18
  - @napuketto/kernel@0.0.13
  - @napuketto/adapter@0.0.16

## 0.1.0

### Minor Changes

- 6903386: feat(cli): 启动接入 QQ 多级来源 + 自动下载管线（resolveQqFiles）——本机未装 QQ 时自动下载官方安装包并缓存，下载失败给出可操作提示

### Patch Changes

- 27a37df: fix(cli): 拒绝占位 QQ 号（123456 / 654321），配置模板护栏硬校验——qq 校验收紧为 5-11 位纯数字并拒绝占位值，占位常量单点定义，两处模板占位注释统一措辞
- Updated dependencies [abbde2f]
  - @napuketto/kernel@0.0.12
  - @napuketto/loader@0.0.17
  - @napuketto/adapter@0.0.15

## 0.0.22

### Patch Changes

- Updated dependencies [555e284]
- Updated dependencies [ebc59b5]
- Updated dependencies [45af90f]
- Updated dependencies [f807879]
  - @napuketto/kernel@0.0.11
  - @napuketto/loader@0.0.16
  - @napuketto/adapter@0.0.14

## 0.0.21

### Patch Changes

- 7872faf: fix(release): 重新发布以修复 npm 包依赖泄漏——此前发布环节绕过 changeset 直发，published 包的 @napuketto/_ 依赖仍是 workspace:_，yarn create / npm install 被迫交互选版本或直接失败；release-npm.ts 现已在发布前把 workspace:\* 改写为 caret 真实版本（发布后恢复），本次随版本号重新发布修正依赖声明
- Updated dependencies [7872faf]
  - @napuketto/adapter@0.0.13

## 0.0.20

### Patch Changes

- @napuketto/adapter@0.0.12

## 0.0.19

### Patch Changes

- Updated dependencies [5bb12a5]
  - @napuketto/loader@0.0.15

## 0.0.18

### Patch Changes

- Updated dependencies [fa86aef]
  - @napuketto/loader@0.0.14

## 0.0.17

### Patch Changes

- Updated dependencies [f42a50c]
  - @napuketto/loader@0.0.13

## 0.0.16

### Patch Changes

- Updated dependencies [98c27a3]
- Updated dependencies [98c27a3]
  - @napuketto/loader@0.0.12
  - @napuketto/kernel@0.0.10
  - @napuketto/adapter@0.0.11

## 0.0.15

### Patch Changes

- Updated dependencies [9b031ea]
  - @napuketto/kernel@0.0.9
  - @napuketto/adapter@0.0.10

## 0.0.14

### Patch Changes

- Updated dependencies [5d4524f]
  - @napuketto/loader@0.0.11

## 0.0.13

### Patch Changes

- Updated dependencies [c60c34c]
  - @napuketto/kernel@0.0.8
  - @napuketto/loader@0.0.10
  - @napuketto/adapter@0.0.9

## 0.0.12

### Patch Changes

- Updated dependencies [affab05]
- Updated dependencies [fa2fb7c]
- Updated dependencies [3507cdd]
- Updated dependencies [52c1519]
- Updated dependencies [de622f5]
  - @napuketto/loader@0.0.9

## 0.0.11

### Patch Changes

- Updated dependencies [42a9786]
  - @napuketto/kernel@0.0.7
  - @napuketto/adapter@0.0.8

## 0.0.10

### Patch Changes

- Updated dependencies [d6f4b56]
- Updated dependencies [f744cf7]
- Updated dependencies [769d457]
  - @napuketto/kernel@0.0.6
  - @napuketto/loader@0.0.8
  - @napuketto/adapter@0.0.7

## 0.0.9

### Patch Changes

- Updated dependencies [d6f4b56]
  - @napuketto/kernel@0.0.5
  - @napuketto/adapter@0.0.6

## 0.0.8

### Patch Changes

- Updated dependencies
  - @napuketto/kernel@0.0.4
  - @napuketto/loader@0.0.7
  - @napuketto/adapter@0.0.5

## 0.0.7

### Patch Changes

- 3265791: feat(cli): 终端渲染登录二维码——loader 在自建宿主（非 IPC）模式经 `NAPUTO_QR` 标记行向 stdout 透出二维码数据，cli `forwardFiltered` 解析后用 qrcode 包渲染终端二维码（png 落盘与 URL 提示保留）；顺带移除未使用的 picocolors 依赖
- Updated dependencies [3265791]
  - @napuketto/loader@0.0.6

## 0.0.6

### Patch Changes

- Updated dependencies [ba49012]
  - @napuketto/loader@0.0.5

## 0.0.5

### Patch Changes

- Updated dependencies
  - @napuketto/kernel@0.0.3
  - @napuketto/adapter@0.0.4
  - @napuketto/loader@0.0.4

## 0.0.4

### Patch Changes

- Updated dependencies [564e383]
- Updated dependencies [b9f06ca]
- Updated dependencies [8e64508]
- Updated dependencies [9005c43]
  - @napuketto/kernel@0.0.2
  - @napuketto/adapter@0.0.3
  - @napuketto/loader@0.0.3

## 0.0.3

### Patch Changes

- 69a53e5: 启动单实例检测（根治多实例抢数据目录锁挂起）：同一账号数据目录（`~/.napuketto/<uin>`）只允许一个实例运行——QQ 原生层（MMKV/登录单例）有锁，第二个实例抢不到会卡在登录初始化后无响应。新增 `instance.lock` 数据目录锁（loader 包）：cli 启动前预检（占用则快速失败并提示占用 PID），self-host 子进程入口兜底获取/释放锁；崩溃残留（PID 已死）自动接管。
- Updated dependencies [007e1ac]
- Updated dependencies [69a53e5]
  - @napuketto/adapter@0.0.2
  - @napuketto/loader@0.0.2

## 0.0.2

### Patch Changes

- d590ab5: 修复 cli bin 在 yarn 1 下启动失败（Windows 用记事本打开 `index.mjs`）：

  - 入口 `src/index.ts` 补 `#!/usr/bin/env node` shebang——yarn 1 依据 bin 文件是否有 `#!` shebang 决定生成 node shim 还是 direct shim；此前无 shebang，yarn 1 生成 `@"...\dist\index.mjs" %*` 的 direct shim，Windows cmd 无法执行 `.mjs`，按文件关联用记事本打开。
  - 修正 `main`/`types`/`exports`/`start` 对不存在的 `index.js`/`index.d.ts` 的死引用，统一指向 `index.mjs`/`index.d.mts`（与 tsdown 实际产物及仓库约定一致）。
