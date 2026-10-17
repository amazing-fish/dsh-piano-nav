# sm-context-piano 最终设计

## 1. 产品标准

产品以 Codex 的可观察琴键导航行为为准：

1. 左侧是一组固定窗口、集中排列的短横线；
2. 只显示用户消息和模型可见文本输出；
3. 工具、编辑、命令、推理和内部状态永远不生成琴键；
4. 连续模型输出合并，非输出内容会截断连续性；
5. 默认最多显示活动节点前后的 20 根琴键，数量、粗细与间距允许用户配置；
6. 悬停产生水平波形和内容预览，点击跳转；
7. 滚动时窗口重新以当前阅读节点为中心。

## 2. DSH 接入边界

宿主入口只注册 `sm-context-piano` 设置命名空间；导航、预览和设置 UI 均在浏览器端完成。客户端使用：

- [data-chat-flow]：有序 ChatView 内容；
- [data-chat-anchor-key]：行级定位锚点；
- [data-conversation-scroll]：滚动容器；
- ConversationSnapshot.chat.order/nodes：业务节点顺序和内容。

插件通过官方 `settings.section` 注册一级设置页，排序值为 21，紧随排序值 20 的 Agent Presets。设置由 `ctx.settingsScope` 读取和写入宿主；插件不注册 HTTP 路由、不访问 token meter、不写 systemPrompt，也不修改 Session。

## 3. 可见节点生成

    snapshot.chat.order
            │ 逐项读取 ChatConversationViewNode
            ▼
    buildNavigationNodes()
            │
            ├─ user / steering → 用户琴键
            ├─ assistant / assistant-step 的 text block → 模型输出琴键
            └─ 其他 kind → 只作为连续性边界，不创建琴键

### 用户节点

- 读取用户 ContentBlock 中的纯文本和图片占位；
- title 使用第一条有效文本行并去除常见 Markdown 前缀；
- preview 最长 520 字符。

### 模型输出节点

- 只读取 kind 等于 text 的 block；
- reasoning、tool-call 和其他 block 会结束当前输出段；
- 相邻 assistant 行若 turn 相同且前后都是 text，则合并为同一琴键；
- tool/edit/read 等独立业务行会结束连续输出，后续模型文本建立新琴键；
- 模型琴键稳定使用“行 key::output:序号”，避免流式内容从一段变多段时更换 DOM key。

同一 ChatView 行内的多段输出可以生成多个琴键，但当前 Harness 只提供行级锚点，因此这些琴键点击后都定位到该行起点。

## 4. 固定琴键窗口

默认值：

- 最大可见数量：20；
- 琴键中心间距：12px；
- 琴键高度：2px；
- 自动轨道高度：(最大可见数量 - 1) × 中心间距 + 琴键高度，默认 230px；
- 默认宽度：10px；
- 当前节点宽度：24px；
- 悬停最大宽度：48px。

当总节点数小于最大可见数量时，全部节点在计算后的轨道内垂直居中；数量超过上限时，只显示一个固定窗口，不压缩间距。

窗口内距当前键超过两个成员的同轮连续 AI 过程输出（明确的 `kind: output`），若至少有两段，折叠为一枚标准琴键。历史轮次入口已经汇总，不再次合并；输入、提问、回答、最终结果以及正在加载或失败的轮次也保持独立。按折叠后的可见条目数计算连续显示槽位，隐藏成员不保留内部空槽。标准宽度、高度、间距、语义颜色和当前键高亮使用既有规则。`maxVisible` 仍限制原始窗口大小，不用折叠省下的槽位加载额外历史。

原始成员索引只用于身份、组范围和导航映射；显示索引用于垂直位置、波形邻接、tooltip 和指针命中。例如 7 段过程输出加历史入口、用户输入、最终结果，折叠后为 4 个槽位，默认键簇跨度为 `(4 - 1) × 12 + 2 = 38px`。展开恢复 10 个紧凑槽位，允许其他可见键改变位置。

    windowStart = clamp(
      activeIndex - floor(visibleCount / 2),
      0,
      totalCount - visibleCount
    )

默认 20 为偶数，因此普通位置下当前节点前方最多 10 个、后方最多 9 个；接近首尾时窗口自动贴边。用户修改上限后使用同一算法。

### 浏览更早或更晚节点

点击当前窗口顶部琴键后：

1. 立即把它设置为 current；
2. 立即重算固定窗口；
3. 平滑滚动到该节点；
4. 新窗口显示它前面的更早节点。

底部琴键同理。窗口重算不依赖浏览器一定触发 scroll 事件。

## 5. 交互

### 悬停

轨道整体接收 Pointer Events。最近的可见琴键获得预览，视觉波峰使用鼠标相对该键的连续纵向偏移，相邻显示槽位按当前设置计算高斯宽度衰减。同键内移动也更新波形；指针跟随宽度按动画帧直接写入，避免跨键后重新启动缓动造成追赶感。悬停不改变折叠状态；显式展开/收起时按可见条目紧凑重排。

折叠键悬停显示“AI · 过程输出（N 段）”、所在轮次与展开提示，不展开成员。命中范围使用实际绘制宽度加 3px 容差，纵向使用紧凑布局中一枚键的槽位；旧源槽位没有残留点击目标。

### 点击

跳转位置为目标行内容坐标减 16px。减少动画模式下即时滚动，否则平滑滚动。

点击折叠键仅展开该段，不加载或跳转；再点击具体成员才沿原有导航路径跳转。鼠标离开和失焦只关闭预览；Escape、显式导航、切换折叠组、轨道滚轮浏览或会话切换收回展开。展开/收起即时切换，所有琴键高度恒定。键盘选择和退出悬停使用 82ms 的单一宽度过渡，鼠标跟随直接更新宽度；减少动画模式下全部宽度变化即时更新。

### 当前阅读节点

阅读线为视口顶部以下 min(120px, 18%视口高度)。滚动跨越节点后更新 current，并按当前上限重新计算琴键窗口。

### 键盘

- ArrowUp/ArrowDown：当前窗口内相邻琴键；
- Home/End：当前窗口首尾；
- Enter/Space：跳转；
- Escape：关闭预览。

键盘浏览不自动展开折叠段；Enter/Space 等价于显式点击，首次展开，下一次激活选中的真实成员。隐藏成员的键盘预览指向可见折叠键，`aria-activedescendant` 始终引用现存 DOM 元素。

## 6. 设置契约

- namespace：`sm-context-piano`；
- `language`：`zh | en | zh-TW`，默认 `zh`；
- `enabled`：布尔值，默认开启；
- `keyHeight`：1–4 的整数，默认 2；
- `keyGap`：6–18 的整数，默认 12；
- `maxVisible`：5–30 的整数，默认 20；
- 所有字段由宿主 schema 与自定义校验共同约束，客户端解码时仍做边界保护；
- 写入采用 DSH live settings，变更后无需刷新页面；
- 插件设置页使用独立三语字典；一级导航名称和琴键轨道 `aria-label` 继续使用 DSH 全局 locale；
- 语言下拉框固定显示自描述选项“简体中文 / English / 繁體中文”，旧配置缺少语言字段时按简体中文解析；
- 关闭时完整卸载琴键 DOM 和监听，重新开启时重新绑定当前 ChatView；
- 设置页中的白底黑框 PNG 只作页内品牌图，原始黑色透明 PNG 保留备用，不改变左侧导航的官方齿轮回退；
- “恢复默认值”通过逐字段 unset 返回宿主默认值，语言同时恢复为简体中文。

## 7. 生命周期和性能

- document MutationObserver 只发现 ChatView 挂载/卸载；
- flow MutationObserver 只观察直接子行增删；
- ResizeObserver 监听根、滚动容器和消息列；
- pointer、scroll 和 layout 通过 rAF 合并，指针仅保存本帧最新坐标；
- 纯指针帧只进行一次实际宽度命中、可见键波形和必要预览更新，不扫描正文阅读位置、不重建历史投影；与滚动或结构失效合并的帧仍走完整同步；
- 预览内容和选中键未变化时复用浮层几何与无障碍属性；鼠标停止后不维持动画循环；
- DOM 以稳定 key 增量复用；
- 卸载时清理 DOM、样式、Observer、监听器、timer 和 rAF。

## 8. 安全

- 不使用 innerHTML；
- 无网络请求或宿主接口；
- 预览只通过 textContent 写入；
- tool/edit/reasoning 内容不进入 KeyDescriptor；
- 错误日志不包含会话正文。

## 9. 文件职责

    src/index.ts             宿主设置 schema 与 namespace 注册
    src/core/config.ts       跨宿主/客户端的设置默认值、边界与高度公式
    src/client/index.ts      客户端设置页注册与导航 apply/effect
    src/client/settings-page.tsx  一级设置页和关于信息
    src/client/keys.ts       用户和可见模型输出分段
    src/client/strip.ts      固定窗口、琴键交互与生命周期
    src/client/rail-slots.ts 可见窗口的折叠投影，不改变历史读模型
    src/client/tooltip.ts    安全预览 DOM
    src/client/styles.ts     Codex 式琴键与浮层样式
    src/client/locales.ts    导航可访问名称
    images/sm-context-piano-icon.png  保留的原始黑色透明 PNG 图标
    images/sm-context-piano-settings-icon.png  设置页白底黑框 PNG 图标
    scripts/grouping.mjs     输出分段和窗口纯逻辑测试
    scripts/smoke.mjs        构建产物测试
    scripts/integration.mjs  jsdom 交互集成测试
    scripts/rail-collapse.mjs 折叠投影及点击/焦点/键盘回归
    scripts/rail-browser.mjs Chromium 实际绘制尺寸与交互回归
