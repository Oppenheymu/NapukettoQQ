---
"@napuketto/cli": patch
"create-napukettoqq": patch
---

fix(cli): 拒绝占位 QQ 号（123456 / 654321），配置模板护栏硬校验——qq 校验收紧为 5-11 位纯数字并拒绝占位值，占位常量单点定义，两处模板占位注释统一措辞
