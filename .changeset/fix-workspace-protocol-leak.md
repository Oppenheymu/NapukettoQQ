---
"@napuketto/cli": patch
"@napuketto/adapter": patch
---

fix(release): 重新发布以修复 npm 包依赖泄漏——此前发布环节绕过 changeset 直发，published 包的 @napuketto/* 依赖仍是 workspace:*，yarn create / npm install 被迫交互选版本或直接失败；release-npm.ts 现已在发布前把 workspace:* 改写为 caret 真实版本（发布后恢复），本次随版本号重新发布修正依赖声明
