---
"@napuketto/kernel": patch
"@napuketto/loader": patch
---

fix(kernel): recallMessage 防御脏参数（null/空字符串不再裸抛 TypeError 或透传到 wrapper 层报「无错误详情」，统一抛 INVALID_PARAM；混合脏值只撤回有效 msgId）
