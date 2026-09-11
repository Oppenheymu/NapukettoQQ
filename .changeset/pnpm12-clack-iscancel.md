---
"create-napukettoqq": patch
---

fix(create-napukettoqq): 适配 `@clack/prompts` 1.8 的类型守卫变更

`@clack/prompts` 1.8.0 起把 `isCancel` 的类型守卫由 `value is symbol` 收窄为
`value is typeof CANCEL_SYMBOL`（unique symbol），无法再从 `string | symbol` 中
排除 `symbol`，导致 `tsc --noEmit` 报 `Property 'trim' does not exist on type
'string | symbol'`。改用运行期 `typeof` 判定取消分支，语义等价且不依赖上游类型
守卫细节。
