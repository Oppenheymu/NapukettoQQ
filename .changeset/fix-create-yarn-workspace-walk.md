---
"create-napukettoqq": patch
---

fix(create): 修复 `yarn create napukettoqq` 自动 install 时报「The nearest package directory doesn't seem to be part of the project declared in <父目录>」——`yarn install` 在子目录执行时会向上探测父目录的 package.json/yarn.lock，若用户父目录（如 ~）含这些文件，会把生成目录误当作 workspace 子包。`scaffoldProject` 在 pm === "yarn" 时额外写空 yarn.lock 隔离独立项目（yarn 自身报错信息亦建议此做法），install 会重写为真实锁文件，无副作用。同时修复调用方未把 pm 传入 scaffoldProject（默认 pnpm）导致该分支永不触发的问题，并修正 JSDoc「yarn 时额外生成空 yarn.lock」的文档谎言。
