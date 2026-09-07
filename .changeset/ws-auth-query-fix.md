---
"@napuketto/adapter": patch
---

fix(adapter): WS/HTTP 查询参数鉴权修复——hasAccessTokenQuery 对 req.url（纯路径无 origin）做 new URL 必抛，access_token 参数鉴权从未生效（连接全被 4401 关闭；T10 E2E 实测抓到，改用 dummy base 解析）；OB11 动作 params 缺省空对象（规范允许省略，此前缺 params 一律 1400）
