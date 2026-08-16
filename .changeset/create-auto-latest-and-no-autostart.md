---
"create-napukettoqq": patch
---

fix(create): 生成项目自动采用最新版 @napuketto/cli（自身依赖缺失或泄漏 workspace:* 时改查 npm registry 最新版兜底），不再交互式选版本；脚手架完成后不再自动启动，改为打开 napuketto.toml 供填写 QQ 号并打印启动指引（cd <项目目录> && yarn/pnpm/npm start）
