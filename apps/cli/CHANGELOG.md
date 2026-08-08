# @napuketto/cli

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
