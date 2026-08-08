# @napuketto/loader

## 0.0.2

### Patch Changes

- 007e1ac: fallow 静态分析优化（克隆清零）：提取 `createWsServerSchema` 传输工厂（OB11/Satori 共用骨架，消除 config schema 克隆）；清理 4 处纯透传无用构造器（delete/set-essence-msg、satori guild.approve/member.approve）；loader smoke.ts 收敛重复文本提取逻辑为 `extractTexts` helper。
- 69a53e5: 启动单实例检测（根治多实例抢数据目录锁挂起）：同一账号数据目录（`~/.napuketto/<uin>`）只允许一个实例运行——QQ 原生层（MMKV/登录单例）有锁，第二个实例抢不到会卡在登录初始化后无响应。新增 `instance.lock` 数据目录锁（loader 包）：cli 启动前预检（占用则快速失败并提示占用 PID），self-host 子进程入口兜底获取/释放锁；崩溃残留（PID 已死）自动接管。
