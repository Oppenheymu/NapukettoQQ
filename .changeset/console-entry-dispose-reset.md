---
"koishi-plugin-adapter-napuketto": patch
---

fix(adapter): 修复插件停止再启动后控制台登录面板消失——`registerConsoleEntry` 的去重 flag 改为随作用域 dispose 重置（`ctx.console.addEntry` 创建的 Entry 是作用域绑定的，插件 stop 时 console 自动移除 entry，flag 不重置则重启后不重新注册）。另优化面板观感：二维码圆角、按钮间距、面板内边距。
