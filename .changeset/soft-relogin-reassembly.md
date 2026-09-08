---
"@napuketto/loader": patch
---

fix(loader): 登录控制相位机——引导失败后迟到的 control login 成功不再误发 logged_in（防 failed→logged_in 误导序列）；ready 态 control login 原地软重登（清理旧装配面后用新登录结果重跑装配链，免整进程重启）；cli 模式 OB11/Satori 装配失败不再被内部 catch 吞错（回归「判引导失败退出」的既有意图）
