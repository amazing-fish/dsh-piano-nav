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

## 合入后自动构建与发布：GitHub Actions OIDC

`verify.yml` 在 PR、`master` push 和手动启动时执行完整验证。`master` 的四项检查
全部成功后，`publish.yml` 收到 `workflow_run` 完成事件，使用该次 CI 的源 SHA 与
`release-intent` 附件核对原 push 的 `before/after` 和 package.json：

- 稳定版本号提升才进入发布；版本不变时跳过，不给发布 job 申请 OIDC 权限。降级、
  预发布、强推、初建分支、来源错配和未通过的 CI 均不授权自动发布。
- 比较整个原 push 的版本变化，覆盖一次推送里先升版本、再追加文档的情况。后续
  工作流不使用可能已经推进的默认分支 SHA 代替验证源；仍要求发布源为当前 master
  HEAD。若验证期间主线推进，停止旧版本意图，检查当前主线后使用手动入口。
- 全部入口与 `recover-release.yml` 共享发布并发组。失败或非 push 的 CI 完成事件
  使用独立并发组，不替换已排队的发布。

正常发版只需在 PR 中提升 package.json 稳定版本，准备同版本 CHANGELOG，并通过
审核后合入。首次启用的本 PR 准备 1.3.6；PR 合入前和注册表核验成功前均不表示
该版本已公开。合入后的实际自动触发和 OIDC 发布需以 Actions 与 npm 结果验收。

保留 `.github/workflows/publish.yml` 的手动入口，可指定稳定版本和完整 master
提交 SHA。两种入口均检查仓库、分支、提交、版本和注册表状态；构建并安装验证 tarball，
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
不需要长期 npm 写 token，也不用关闭账号2FA。正常版本变更合入后自动发布，无需再次填写输入；需要手动补发未公开版本时，在 GitHub Actions
选择 `Publish verified npm package`，从 `master` 启动并填写预期版本与40位提交 SHA。
默认分支变更或版本已存在会在上传前失败，需重新核对本次发布意图。

官方当前规则：新绑定必须在 **2天内完成首次成功发布**，否则过期；保存配置本身
不验证连接。因此在工作流合入、下一次真实发布就绪时绑定，不为了测试绑定另造版本，
不重复上传已发布的1.3.3。首次 OIDC 发布成功前，状态记为“待实发验证”。

账号本人于2026-10-18创建绑定；1.3.4 已于2026-10-19完成首次真实OIDC发布、
注册表下载及安装/加载核验，#60 已关闭。后续 1.3.5 npm 发布同样成功；其 GitHub
Release 曾因元数据传播竞态中断，已于2026-10-20恢复，过程见 #65。

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

## npm 已公开后的核验重试与 Release 恢复

`verify-published.mjs` 分别重试精确元数据查询和 `npm pack` 下载，只接受 npm 的
`E404` / `ETARGET` 传播错误。每步最多9次，间隔15秒；每次网络请求关闭 npm 内层
重试，网络超时30秒，下载每次使用新缓存并要求在线校验。认证、网络、完整性和
其他错误立即失败；超过次数也停止。重试不运行 `npm publish`。

若 npm 已存在而 GitHub Release 缺失或停留在草稿，使用
`.github/workflows/recover-release.yml` 的 `Recover verified GitHub Release`，
从 `master` 手动启动：

| 输入 | 含义 |
| --- | --- |
| `version` | 已公开的稳定版本，例如 `1.3.5` |
| `commit` | 原发布源的完整40位 SHA，不填当前 master 来代替 |
| `run_id` | 原 `publish.yml` 的运行 ID，需保有 `npm-release-evidence` 附件 |

恢复接受 `publish.yml` 的手动 `workflow_dispatch` 或自动 `workflow_run` 原发布记录，
核对原运行的仓库、工作流、分支、源提交和版本；下载该次冻结包及清单，
从注册表重新下载并对照字节，使用原版本的宿主依赖再次执行安装/加载契约。
它不重新构建发布包，也不申请 npm OIDC 权限。过期或缺失的原CI附件需人工处理，
不能用当前源码重新打包来代替已发布字节。

核验通过后才补齐标签、草稿或缺失附件，并公开同一个 Release。已有标签必须指向
原发布源，已有包摘要及核验记录必须匹配；不一致即停止，不覆盖附件。完整公开的
Release 重跑时不再写入，上传中断的草稿保留已核验附件供下次接续。恢复旧版本时
不要求 npm latest 仍指向它，也不改变 npm dist-tag 或将旧 Release 设为 GitHub Latest。

恢复与正常发布共享同一并发组，避免两条流程同时写发布状态。一次性的
`complete-1.3.5.yml` 已由此通用入口替代。场景回归覆盖合成 npm/GitHub 响应。2026-10-21，PR #67 合入后的
[真实恢复运行39466178368](https://github.com/amazing-fish/dsh-piano-nav/actions/runs/39466178368)
以1.3.5、原发布源 `ba7172d5adb3fa69b7b9f9725065e4b91e760a2c` 和原运行39379588893
通过：取回冻结包、重新下载注册表字节、安装及host/client加载均成功，111193 bytes /12文件，
SHA256 `1f9fd712236fbcd407986b0ab7a84f7c158e8cea514c354c83d2ba3a8ab66c95`。
现有公开Release及两个附件ID和摘要保留，未重复上传npm或Release附件。该实跑验证了
“完整公开版本再次恢复”的幂等路径；缺失草稿、上传中断及错误拒绝路径仍以场景回归为证据。
