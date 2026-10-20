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

发布账号须先在 npm 的 Account → Two-Factor Authentication 中启用 2FA。
Windows Hello / 安全密钥由账号本人配置并保管恢复码。命令行登录成功后，
`npm publish` 仍可能要求对本次发布进行一次网页验证。

通过 npm 正式浏览器流程登录，不把 token、密码或验证码写入文档、日志或聊天：

```powershell
npm login --auth-type=web --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
$version = node -p "require('./package.json').version"
npm publish ".\artifacts\dsh-piano-nav-$version.tgz" --access public --tag latest --registry=https://registry.npmjs.org
```

没有可自动打开的本地浏览器时，为 `npm login` 或 `npm publish` 增加
`--browser=false`，在账号本人浏览器打开该次命令输出的官方授权链接，
命令行保持等待。登录链接与发布验证链接分别绑定各自操作；链接失效后
重新发起对应命令，不保存授权链接到文档，也不交接密码或一次性验证码。

发布验证过的 tarball；上传前不重新生成另一份内容。按 npm 提示完成浏览器/2FA 授权。
认证缺失、权限不足或名称不可注册时停止；dry-run 不代表已发布。

若命令退出 0 并提示包正在处理，先等待注册表公开版本，不重复上传。
首次查询可能暂时返回 404；以版本、dist-tag 和远端产物核验结果作为发布完成依据。

## 发布后核验

```powershell
npm view "dsh-piano-nav@$version" name version dist.integrity dist.tarball --json --registry=https://registry.npmjs.org
npm dist-tag ls dsh-piano-nav --registry=https://registry.npmjs.org
```

核对远端 integrity 和本地清单一致，下载后再做安装/加载验证，记录源提交和实际日期。
成功后才将 CHANGELOG 的 release preparation 改为真实发布日期。

## 免逐次网页验证：GitHub Actions OIDC

仓库提供 `.github/workflows/publish.yml`，手动启动发布指定的稳定版本和完整 master
提交 SHA。工作流检查仓库、分支、提交、版本和注册表状态；构建并安装验证 tarball，
核对字节未变后才上传该文件，随后用全新缓存下载并执行同一安装/加载检查。
已有版本和网络/服务端错误均停止，不自动覆盖或重发。`pnpm test:package` 也接受
`PIANO_PACKAGE_TARBALL` 指向下载包，避免核验时重新打一个不同的包。

合入工作流后，在 npm 的包设置 → Trusted publishing 中一次绑定：

| 字段 | 值 |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `amazing-fish` |
| Repository | `dsh-piano-nav` |
| Workflow filename | `publish.yml`（只填文件名） |
| Environment | 留空（工作流未使用 environment） |
| Allowed actions | 允许直接 `npm publish`，仅允许 `npm stage publish` 不足以运行本流程 |

发布在 GitHub-hosted runner 上使用 `id-token: write`；Node24，npm至少11.5.1。
不需要长期 npm 写 token，也不用关闭账号2FA。每次后续授权发布时，在 GitHub Actions
选择 `Publish verified npm package`，从 `master` 启动并填写预期版本与40位提交 SHA。
默认分支变更或版本已存在会在上传前失败，需重新核对本次发布意图。

官方当前规则：新绑定必须在 **2天内完成首次成功发布**，否则过期；保存配置本身
不验证连接。因此在工作流合入、下一次真实发布就绪时绑定，不为了测试绑定另造版本，
不重复上传已发布的1.3.3。首次 OIDC 发布成功前，状态记为“待实发验证”。

2026-10-18：仓库侧工作流已准备，npm端绑定及首次真实OIDC发布尚未完成。
本地验证覆盖发布防护和已公开1.3.3的注册表/下载包核验，不能代替OIDC认证成功。

官方参考：[publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)、
[login](https://docs.npmjs.com/cli/v11/commands/npm-login/)、
[2FA 设置](https://docs.npmjs.com/configuring-two-factor-authentication/)、
[trusted publishing](https://docs.npmjs.com/trusted-publishers/)。

## dsh-market 更新说明与安装来源

npm 发布与 GitHub Release 是不同交付。`dsh-market` 的更新说明优先读取市场每日
抓取的 GitHub Release；没有可用 Release 时退回提交列表。提交列表找不到用户所装
提交的边界，会注明“最近提交（无法对应你当前安装的版本，仅供参考）”。
Git 安装的更新范围显示提交 SHA；npm 安装显示语义版本。不要把 SHA 范围解释成
npm 版本号错误，也不要仅修改 package.json 就宣称市场说明已更新。

发布工作流在 npm 注册表、下载包字节及安装/加载核验全部成功后，由独立的
`github-release` job 创建 `v<version>` 标签和对应 GitHub Release，指向实际发布源
提交，附同一 tarball 与核验记录，说明摘自 CHANGELOG 的对应版本段。仅此 job
获得 `contents: write`，npm 发布 job 继续只读仓库。首次执行已于 1.3.4 成功，见
[发布工作流](https://github.com/amazing-fish/dsh-piano-nav/actions/runs/39196082947)。
若 npm 已成功而 Release 创建失败，保留已发布版本，单独修复 Release；不要重发
同一 npm 版本或为了补说明另造版本。市场目录和更新说明有每日刷新、客户端缓存，
GitHub Release 创建成功也不等于用户市场页面已立即更新。

依据：dsh-market 的 `src/changelog.ts` 与 `src/client/MarketSection.tsx`。
