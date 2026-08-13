---
"@napuketto/loader": patch
---

fix(loader): WSL 下 QQ 安装定位——常见路径探测支持 `/mnt/<盘符>/` 挂载映射，installDir 推导改用 `dirname`（原反斜杠切分在 Linux 路径下切错字符）
