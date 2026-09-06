---
"@napuketto/loader": patch
---

修复自建宿主「登录失败仍上报 ready」：bootstrap() 全链返回 boolean 结果信号，各失败路径（登录失败、协议服务装配失败、kernel 导入/导出异常等）不再被静默吞掉后误报 ready。引导未完成时 IPC 模式补发通用 status failed（已发过带具体错误码的 failed 如 NOT_LOGIN 时不覆盖）并以 exit code 1 退出，交由 koishi driver 既有重启循环接管；cli 模式失败同样退出，不再留驻。附带修复非 IPC 模式 OB11/Satori 装配失败不再 fail-soft 常驻。
