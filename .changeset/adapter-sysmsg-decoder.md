---
"@napuketto/adapter": minor
---

feat(adapter): onRecvSysMsg protobuf 解码器落地——手写 wire-format 解码（零依赖，BigInt 保 64 位精度）+ 回调参数防御性收窄 + 信封提取（2 条真实样本校准字段号）+ 识别层。⚠️ 识别表当前为空：card/title/sign 的 (msgType, subType) 判别值无样本支撑，宁可漏报不错报——未识别一律打结构化校准日志不广播；后续拿到真实样本只需往 KIND_TABLE 登记规则即可开始广播对应 OB11 notice。
