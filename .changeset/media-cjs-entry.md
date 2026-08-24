---
"@napuketto/media": patch
---

fix(media): 补充 CJS 入口（双格式构建 + exports require 条件），修复 koishi 适配器生产加载报 ERR_PACKAGE_PATH_NOT_EXPORTED。execa / file-type（ESM-only）强制打进产物，避免 CJS require 抛 ERR_REQUIRE_ESM。
