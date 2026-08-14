---
"koishi-plugin-adapter-napuketto": patch
---

fix(adapter): 修复控制台插件详情页不显示「本插件提供了…」说明——`usage` 原在 `index.ts` 模块级导出，被 koishi loader 的 `unwrapExports`（`module?.default || module`）随 `export default NapukettoBot` 解包时丢弃；改为挂到 `NapukettoBot` 类上（namespace 声明合并），`PackageProvider.parseExports` 的 `exports?.usage` 才能读到。同时把二维码面板 `get()` 的诊断日志从裸 `console.log` 改为 `logger.info`，便于确认前端 PULL 是否触发
