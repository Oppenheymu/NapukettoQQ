---
"@napuketto/loader": patch
"koishi-plugin-adapter-napuketto": patch
---

fix(loader): WSL 生产事故修复——① Linux spawn 前预检 wine（缺失抛可读错误 + apt 指引），并挂 child 'error' 监听兜底，此前 spawn ENOENT 异步 'error' 无监听者直接 uncaughtException 崩掉整个 koishi；② ensureQqFiles/launchSelfHost 新增 onStage 阶段回调（下载/校验/解包/提取/win-node/spawn 全程日志），首次下载 313MB 安装包不再静默；③ 下载 tmp 文件唯一化（pid+时间戳）并解包前校验存在性，修复「下载成功但 7z 解包报 No such file or directory」并发竞态；④ downloadFile 完成态 stat 校验（缺失/空文件立即报错）
