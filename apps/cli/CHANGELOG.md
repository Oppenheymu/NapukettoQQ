# @napuketto/cli

## 0.0.2

### Patch Changes

- d590ab5: 修复 cli bin 在 yarn 1 下启动失败（Windows 用记事本打开 `index.mjs`）：

  - 入口 `src/index.ts` 补 `#!/usr/bin/env node` shebang——yarn 1 依据 bin 文件是否有 `#!` shebang 决定生成 node shim 还是 direct shim；此前无 shebang，yarn 1 生成 `@"...\dist\index.mjs" %*` 的 direct shim，Windows cmd 无法执行 `.mjs`，按文件关联用记事本打开。
  - 修正 `main`/`types`/`exports`/`start` 对不存在的 `index.js`/`index.d.ts` 的死引用，统一指向 `index.mjs`/`index.d.mts`（与 tsdown 实际产物及仓库约定一致）。
