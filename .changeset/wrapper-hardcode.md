---
"@napuketto/kernel": patch
"@napuketto/loader": patch
---

fix(kernel/loader): wrapper 配置硬编码治理——major.node 解析 appid 失败时显式抛 KernelError（删除 537237765 静默兜底，该 appid 属已下线登录服务的 9.9.31），系统信息改为运行时探测（os.release/version/platform，不再写死 Windows 构建号），engine/session 配置裸魔数抽为具名常量并补契约注释。
