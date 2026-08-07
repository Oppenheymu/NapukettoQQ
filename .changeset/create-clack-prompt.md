---
"create-napukettoqq": minor
---

脚手架交互层全面升级（@clack/prompts），模板独立化，生成项目精简：

- 交互换 `@clack/prompts`（create-vue / create-turbo 同款）：intro/outro 边框、
  spinner 进度、log 分级输出、取消处理，替代 prompts+kleur，一站式现代化。
- 模板独立化为 `templates/` 目录（随 npm 包发布，`files` 含 `templates/`），
  不再硬编码在源码；占位符 `{{packageName}}` / `{{cliVersion}}` / `{{dataDir}}`
  渲染，未提供的占位符抛错防漏插值。
- 生成项目精简为 `package.json` + `napuketto.toml` 两个文件：用户项目是
  「运行壳」，生成后不写代码、不开仓库，readme / .gitignore 是死文件，已移除。
- 新增参数：`-f/--forced`（目标目录非空时强制清空覆盖）、`-y/--yes`（全默认
  跳过交互）、`-h/--help`（帮助）。
- 修复 `templates/napuketto.toml` 被根 `.gitignore` 的 `napuketto.toml` 规则
  误伤忽略（git 不跟踪则 clone 后脚手架无法生成配置）：新增例外规则
  `!apps/create-napukettoqq/templates/napuketto.toml`。
