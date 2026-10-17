# DSH Piano Navigator

**把长 Agent 会话变成一条可预览、可定位的语义导航轨道。**

[English](https://github.com/amazing-fish/dsh-sm-context-piano/blob/master/README.en.md) · [使用指南](https://github.com/amazing-fish/dsh-sm-context-piano/blob/master/docs/USAGE.md) · [文档](https://github.com/amazing-fish/dsh-sm-context-piano/blob/master/docs/README.md) · [反馈](https://github.com/amazing-fish/dsh-sm-context-piano/issues)

[![CI](https://github.com/amazing-fish/dsh-sm-context-piano/actions/workflows/verify.yml/badge.svg)](https://github.com/amazing-fish/dsh-sm-context-piano/actions/workflows/verify.yml) [![npm](https://img.shields.io/npm/v/dsh-piano-nav)](https://www.npmjs.com/package/dsh-piano-nav) [![MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

面向 **DeepSeek Harness Web GUI**，由 [amazing-fish](https://github.com/amazing-fish) 独立维护。项目已发展为包含完整历史导航、语义问答、过程折叠和连续指针交互的导航器。来源与版权记录见 [NOTICE](NOTICE.md)。

## 效果预览

![不同 step 的实际琴键效果：输入、过程、提问、回答、最终结果、展开回折和深色主题](https://raw.githubusercontent.com/amazing-fish/dsh-sm-context-piano/0e2523aa02773a8ff19e524024348b2144c6d98f/docs/assets/semantic-steps.gif)

循环展示 **蓝色用户输入 → 灰色过程组 → 展开的过程 step → 琥珀色 AI 提问 → 绿色用户回答 → 紫色双线最终结果 → 定位后回折 → 深色过程键**。预览来自实际插件与原生组件，使用合成会话；各状态停留片刻以便观察。深色主题的普通过程键为白色或近白。

<details>
<summary>连续鼠标跟随：查看上一轮修复前后对比</summary>

![同一鼠标轨迹下，修复前逐键跳动与修复后连续跟随的对比](https://raw.githubusercontent.com/amazing-fish/dsh-sm-context-piano/0e2523aa02773a8ff19e524024348b2144c6d98f/docs/assets/pointer-follow-before-after.gif)

同一轨迹依次慢速、快速、立即反向；左侧为修复前，右侧为当前效果。实际插件浏览器回放使用合成会话，琴键放大 4 倍。图中的 5/120 和 120/120 是微移期间的宽度变化次数，**不是 FPS**。

</details>

## 安装

需要 DSH 的 `web` profile，以及 Node.js `^22.19.0 || >=24.0.0`。

```powershell
dsh plugin --profile web add dsh-piano-nav
```

刷新 Web GUI，在设置中找到 **琴键导航 / Piano Navigator**。包名为 `dsh-piano-nav`；npm 上已有的 `dsh-piano` 是另一款音乐插件。

从旧作用域包或本地链接迁移时，先移除旧插件的加载条目，再添加新包，避免重复装载。设置 entry id 保持兼容，移除旧条目时保留持久化设置。详见[迁移步骤](https://github.com/amazing-fish/dsh-sm-context-piano/blob/master/docs/USAGE.md#从旧包迁移)。

## 它能帮你找到什么

| 导航对象 | 显示与行为 |
| --- | --- |
| 用户输入 | 独立入口，保留对话起点 |
| AI 过程输出 | 文本按语义分段；同轮连续过程可折叠为一枚键 |
| 最终结果 | 与过程输出分开标识 |
| AI 提问 / 用户回答 | 展示 `ask_user_question` 的问题、回答和状态 |
| 更早的历史轮次 | 未加载时显示真实大纲，点击交由 DSH 原生导航加载 |

普通工具日志、编辑、读取和推理不生成独立琴键；结构化问答是明确的例外。未加载轮次不会被猜测成虚构的细粒度段落。

## 独立演进的核心能力

- **一条完整历史轨道**：合并轮次大纲和已加载语义段；接管成功后只显示 Piano，条件不满足时恢复原生导航。
- **按需展开过程**：首次点击折叠键展示成员，再点击成员定位；自动展开可揭示的原生过程区或问答卡片。被动滚动和流式更新保留手动展开。
- **连续指针波形**：同键内移动也连续跟随；动画帧只更新可见键与必要预览，鼠标停止后没有常驻循环。
- **固定显示窗口**：默认 20 枚键，保持稳定间距；轨道滚轮和键盘可以前后浏览全部可用入口。
- **完整日常交互**：纯文本预览、阅读高亮、稳定节点复用、明暗主题、键盘操作与减少动画。
- **三语持久化设置**：简体中文、English、繁體中文；粗细、间距和窗口容量即时调整。

## 常用操作

| 操作 | 结果 |
| --- | --- |
| 沿轨道移动鼠标 | 连续波形跟随，最近的键显示预览 |
| 点击普通键 / `Enter` / `Space` | 定位或交由原生导航加载目标 |
| 首次激活过程折叠键 | 展开该组，其他已展开组先收起 |
| 轨道滚轮 | 前后浏览窗口，不滚动正文，并收回手动展开 |
| `↑` / `↓`、`PageUp` / `PageDown` | 移动选择，必要时调整窗口 |
| `Home` / `End` | 选择会话导航列表首尾 |
| `Escape` | 关闭预览、收回展开并取消当前导航意图 |

默认键高 **2px**、中心间距 **12px**、最多 **20** 枚可见键。设置范围、折叠规则和异常行为见[使用指南](https://github.com/amazing-fish/dsh-sm-context-piano/blob/master/docs/USAGE.md)。

<details>
<summary>查看当前版本设置页</summary>

![DSH Piano Navigator 当前设置页：语言、粗细、间距、显示数量与安装命令](https://raw.githubusercontent.com/amazing-fish/dsh-sm-context-piano/0e2523aa02773a8ff19e524024348b2144c6d98f/docs/assets/settings.png)

实际构建组件的简体中文截图，使用演示设置数据。图片来源与版本见[素材说明](https://github.com/amazing-fish/dsh-sm-context-piano/blob/0e2523aa02773a8ff19e524024348b2144c6d98f/docs/assets/SOURCES.md)。

</details>

## 兼容性与数据边界

当前开发依赖固定到 DSH `0.2.0-rc.2`；类型与集成测试、固定官方源码的原生组件浏览器回归分别验证不同层面的兼容性。[兼容说明](https://github.com/amazing-fish/dsh-sm-context-piano/blob/master/docs/COMPATIBILITY.md)列明适配方式和验证范围。

导航通过受校验的 DOM 桥接复用原生分页与滚动状态，尚不是官方稳定的导航替换 API。容器过窄、没有目标或契约变化时恢复原生界面。同一行的多个语义段可能落在同一行起点。

Piano 只读取导航信息、显示纯文本预览并保存自身设置；不改写消息、不注入系统提示、不提交问答答案。历史加载请求由 DSH 执行。

## 开发与文档

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm test:package
```

| 入口 | 内容 |
| --- | --- |
| [贡献指南](https://github.com/amazing-fish/dsh-sm-context-piano/blob/master/CONTRIBUTING.md) | 环境、目录职责、测试与提交要求 |
| [架构](https://github.com/amazing-fish/dsh-sm-context-piano/blob/master/docs/ARCHITECTURE.md) | 读模型、原生所有权、调度与生命周期 |
| [语义规则](https://github.com/amazing-fish/dsh-sm-context-piano/blob/master/docs/SEMANTIC_KEYS.md) | 分段、问答、最终结果与折叠 |
| [发布指南](https://github.com/amazing-fish/dsh-sm-context-piano/blob/master/docs/RELEASING.md) | 打包、认证、tarball 上传与核验 |
| [变更记录](CHANGELOG.md) | 独立维护版本的变化 |

实现位于 `src/`，回归与夹具位于 `scripts/`，跟踪构建产物位于 `lib/`。当前文档从 `docs/README.md` 进入，过往阶段方案和旧截图归入 `docs/archive/`。

## 来源与许可

基于 [hjj345/dsh-sm-context-piano](https://github.com/hjj345/dsh-sm-context-piano) 演进，保留原有 MIT 版权；当前功能、适配与发布由本仓库维护。详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE.md)。
