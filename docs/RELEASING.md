# npm 发布

包名为 `dsh-piano-nav`；`dsh-piano` 已被音乐插件使用。1.3.0 从原先的 1.3.0-rc.1
演进，首次使用新包名。以 package.json 和实际注册表状态为准。

## 准备同一份产物

从计划发布且已审阅的提交开始：

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm test:package
```

`test:package` 生成 `artifacts/dsh-piano-nav-<version>.tgz` 与清单，检查文件、身份、
DSH patch、兼容 entry，并从 tarball 实际安装、加载 host/client。验证环境提供宿主
peer 依赖，不把开发依赖复制进包。普通 `npm pack` 的 prepack 会先构建。

## 授权与上传

通过 npm 正式浏览器流程登录，不把 token、密码或验证码写入文档、日志或聊天：

```powershell
npm login --auth-type=web --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
$version = node -p "require('./package.json').version"
npm publish ".\artifacts\dsh-piano-nav-$version.tgz" --access public --tag latest --registry=https://registry.npmjs.org
```

发布验证过的 tarball；上传前不重新生成另一份内容。按 npm 提示完成浏览器/2FA 授权。
认证缺失、权限不足或名称不可注册时停止；dry-run 不代表已发布。

## 发布后核验

```powershell
npm view "dsh-piano-nav@$version" name version dist.integrity dist.tarball --json --registry=https://registry.npmjs.org
npm dist-tag ls dsh-piano-nav --registry=https://registry.npmjs.org
```

核对远端 integrity 和本地清单一致，下载后再做安装/加载验证，记录源提交和实际日期。
成功后才将 CHANGELOG 的 release preparation 改为真实发布日期。

首发后可在 npm 配置 trusted publisher，再另行增加已验证的发布 workflow。当前仓库
没有预设已登录或已配置 OIDC 的承诺。

官方参考：[publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)、
[login](https://docs.npmjs.com/cli/v11/commands/npm-login/)、
[trusted publishing](https://docs.npmjs.com/trusted-publishers/)。
