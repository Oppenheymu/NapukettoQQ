# create-napukettoqq

## 0.2.8

### Patch Changes

- @napuketto/cli@0.0.9

## 0.2.7

### Patch Changes

- @napuketto/cli@0.0.8

## 0.2.6

### Patch Changes

- Updated dependencies [3265791]
  - @napuketto/cli@0.0.7

## 0.2.5

### Patch Changes

- f4db06a: feat(create-napukettoqq): 美化 v4 对齐 koishi create 观感——文件夹名输入改淡灰 placeholder（去 initialValue，直接回车用默认名、键入字符从空自定义）、按调用方包管理器品牌色定向（pnpm 黄 / yarn 蓝 / npm 红，picocolors 16 色近似）、生成后展示项目文件树、去掉「包管理器自动检测」冗余 log

## 0.2.4

### Patch Changes

- @napuketto/cli@0.0.6

## 0.2.3

### Patch Changes

- @napuketto/cli@0.0.5

## 0.2.2

### Patch Changes

- @napuketto/cli@0.0.4

## 0.2.1

### Patch Changes

- 0192e20: 修复 Windows 下自动安装依赖时触发 Node ≥22 的 DEP0190 告警（`shell: true` + args 数组改为拼单命令行字符串，规避 `spawn` 参数不转义的弃用警告）。
- Updated dependencies [69a53e5]
  - @napuketto/cli@0.0.3

## 0.2.0

### Minor Changes

- aed9b67: 脚手架交互层全面升级（@clack/prompts），模板独立化，生成项目精简：

  - 交互换 `@clack/prompts`（create-vue / create-turbo 同款）：intro/outro 边框、
    spinner 进度、log 分级输出、取消处理，替代 prompts+kleur，一站式现代化。
  - 模板独立化为 `templates/` 目录（随 npm 包发布，`files` 含 `templates/`），
    不再硬编码在源码；占位符 `{{packageName}}` / `{{cliVersion}}` / `{{dataDir}}`
    渲染，未提供的占位符抛错防漏插值。
  - 生成项目精简为 `package.json` + `napuketto.toml` 两个文件：用户项目是
    「运行壳」，生成后不写代码、不开仓库，readme / .gitignore 是死文件，已移除。
  - 新增参数：`-f/--forced`（目标目录非空时强制清空覆盖）、`-y/--yes`（全默认
    跳过交互）、`-h/--help`（帮助）。
  - 模板文件统一 `.tmpl` 后缀（`templates/*.tmpl`）：避免 VS Code 的 TOML/JSON
    语言服务把 `{{dataDir}}` 等占位符当非法语法报 `expected identifier`；
    `scaffold.ts` 写盘时去掉 `.tmpl` 后缀。
  - 删除冗余的根目录 `napuketto.toml.example`（有 `config init` 与脚手架生成
    配置，示例文件三处重复维护无人阅读），同步清理 `config-cmds.ts` / `readme.md`
    引用。
  - 修复 `templates/napuketto.toml` 被根 `.gitignore` 的 `napuketto.toml` 规则
    误伤忽略（git 不跟踪则 clone 后脚手架无法生成配置）：模板改 `.tmpl` 后缀后
    不再匹配该规则，例外规则收敛为 `!apps/create-napukettoqq/templates/*.tmpl`。

### Patch Changes

- Updated dependencies [d590ab5]
  - @napuketto/cli@0.0.2
