---
"koishi-plugin-adapter-napuketto": patch
---

fix(adapter): 修复控制台登录面板二维码不显示——QrCodePanel 模板标签大小写不匹配（`<qrcode-panel>` 反推为 `QrcodePanel`，与 import 的 `QrCodePanel` 不匹配 → 组件被 tree-shaking 删除，二维码渲染为空自定义元素）。改 PascalCase `<QrCodePanel>` 后实测二维码正常展示。
