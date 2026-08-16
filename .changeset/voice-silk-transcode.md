---
"@napuketto/adapter": patch
---

fix(adapter): OB11 record 段发送语音时，非 silk 音频自动转码为 silk（QQ 语音格式）再送 kernel；ensureSilk 上移为 adapter core 共享 helper（onebot11/satori 共用），kernel 不 import media 的解耦红线不变。
