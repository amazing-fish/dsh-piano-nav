# 兼容说明

[返回首页](../README.md)

## 当前依据

| 层次 | 声明或证据 |
| --- | --- |
| Node.js | `^22.19.0 || >=24.0.0`；CI 使用 Node 24 |
| DSH 引擎声明 | `>=0.1.7-rc.1 || >=0.2.0-rc.1`，以 package.json 为准 |
| 构建与类型基线 | 直接 DSH 开发依赖固定为 `0.2.0-rc.2` |
| 原生组件浏览器回归 | 固定官方源码 `c291e7961a515f6d7af9304e7fd1d257929aef26` 的 ChatView/TurnNavigator 与语义组件，Session/消息叶子为夹具 |
| DOM 与设置契约 | 契约、jsdom、浏览器夹具覆盖导航层级变化、虚拟按钮、问答、折叠和卸载 |
| 系统 | Windows / Ubuntu 构建与集成 CI；Chromium 浏览器 CI 在 Ubuntu 运行 |

引擎范围是安装声明，不表示所有后续 DSH 版本都经过端到端验收。固定原生源码、当前
发布包类型与用户现场是不同层次的证据。

## 接入方式

通过公开 Chat target/keyed sources 读取已加载节点，以 `turnOutline` 和
`navigation.items()` 合并完整轮次读模型。

当前使用受校验的 DOM 桥接，并非官方稳定的导航替换 API。`native-navigation.ts`
以本地化 aria 标签、真实按钮和消息锚点校验原生结构，复用分页、滚动恢复和待落地管理。
原生组件保持挂载；接管时隐藏原生导航，失配、关闭和卸载时恢复保存的属性。

依赖 `[data-chat-flow]`、`[data-chat-anchor-key]`、`[data-conversation-scroll]`
及受约束的 `hidden="until-found"` / `beforematch` 过程揭示入口。

## 明确边界

- 细粒度语义键来自实际加载的节点；未加载轮次只有真实大纲入口。
- 同一 DOM 行内的多个文本段可能定位到同一行起点。
- 提问/回答只投影 `ask_user_question` 的结构化交换，不运行工具或提交回应。
- 普通 `hidden` 容器不会被强制打开，只使用已校验的原生揭示入口。
- 虚拟化可能暂时禁用部分历史入口，插件不复制加载器绕过缺失动作。
- 空间或适配条件不足时恢复原生界面。

## DSH 升级时

运行 `pnpm verify`、`pnpm test:package` 和贡献指南中的浏览器检查，再在实际 DSH
普通/紧凑模式验收历史加载、流式输出、问答展开、成员定位、最后结果回折、会话切换
及关闭回退。发现契约变化时先恢复原生导航，再调整适配器。
