window.__ModuleLoader__.load({
	id: "dsh-piano-nav",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/core/colors.ts
		/** Persisted semantic overrides. Empty means follow the host's current theme. */
		const COLOR_FIELDS = {
			input: "colorInput",
			output: "colorOutput",
			question: "colorQuestion",
			answer: "colorAnswer",
			final: "colorFinal",
			turn: "colorHistory"
		};
		const SEMANTIC_KINDS = Object.keys(COLOR_FIELDS);
		const COLOR_PATTERN = /^(?:|#[0-9a-fA-F]{6})$/;
		const DEFAULT_COLORS = {
			colorInput: "",
			colorOutput: "",
			colorQuestion: "",
			colorAnswer: "",
			colorFinal: "",
			colorHistory: ""
		};
		const THEME_COLORS = {
			light: {
				input: ["#2563eb", "#1d4ed8"],
				output: ["#8a8a8a", "#6b6b6b"],
				question: ["#b45309", "#92400e"],
				answer: ["#15803d", "#166534"],
				final: ["#7c3aed", "#6d28d9"],
				turn: ["#202124", "#000000"]
			},
			dark: {
				input: ["#60a5fa", "#93c5fd"],
				output: ["#e5e5e5", "#ffffff"],
				question: ["#fbbf24", "#fde68a"],
				answer: ["#4ade80", "#86efac"],
				final: ["#a78bfa", "#c4b5fd"],
				turn: ["#f1f1f3", "#ffffff"]
			}
		};
		function isPianoColor(value) {
			return typeof value === "string" && COLOR_PATTERN.test(value);
		}
		const activeColor = (value) => `color-mix(in srgb, ${value} 76%, var(--smcp-active-mix, #000))`;
		/** A palette edit changes two inherited variables; it never needs key layout. */
		function syncPalette(style, next, previous = {}) {
			for (const kind of SEMANTIC_KINDS) {
				const field = COLOR_FIELDS[kind], value = next[field];
				if (value === previous[field]) continue;
				const normal = `--smcp-${kind}-color`, active = `--smcp-${kind}-active-color`;
				if (value && isPianoColor(value)) {
					style.setProperty(normal, value);
					style.setProperty(active, activeColor(value));
				} else {
					style.removeProperty(normal);
					style.removeProperty(active);
				}
			}
		}
		/** Same CSS variables on the rail, legend and preview; never accepts arbitrary CSS. */
		function paletteStyle(settings) {
			const style = {};
			for (const kind of SEMANTIC_KINDS) {
				const value = settings[COLOR_FIELDS[kind]];
				if (value && isPianoColor(value)) {
					style[`--smcp-${kind}-color`] = value;
					style[`--smcp-${kind}-active-color`] = activeColor(value);
				}
			}
			return style;
		}
		//#endregion
		//#region src/core/config.ts
		/** Shared settings vocabulary for host registration and browser rendering. */
		/**
		* Settings entry id under the DSH 0.1.7 settings contract. Kept aligned with
		* the former settings namespace so existing stored values migrate as-is.
		*/
		const SETTINGS_ENTRY_ID = "sm-context-piano";
		const PIANO_LANGUAGE_IDS = [
			"zh",
			"en",
			"zh-TW"
		];
		const DEFAULT_SETTINGS = {
			...DEFAULT_COLORS,
			language: "zh",
			enabled: true,
			keyHeight: 2,
			keyGap: 12,
			maxVisible: 20
		};
		const SETTINGS_FIELDS = Object.keys(DEFAULT_SETTINGS);
		const SETTINGS_LIMITS = {
			keyHeight: {
				min: 1,
				max: 4
			},
			keyGap: {
				min: 6,
				max: 18
			},
			maxVisible: {
				min: 5,
				max: 30
			}
		};
		const integer$1 = (value, fallback, min, max) => {
			if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
			return Math.max(min, Math.min(max, value));
		};
		function isPianoLanguage(value) {
			return typeof value === "string" && PIANO_LANGUAGE_IDS.includes(value);
		}
		function decodeSettings(value) {
			if (typeof value !== "object" || value === null) return void 0;
			const source = value;
			return {
				...Object.fromEntries(Object.values(COLOR_FIELDS).map((field) => [field, isPianoColor(source[field]) ? source[field] : ""])),
				language: isPianoLanguage(source.language) ? source.language : DEFAULT_SETTINGS.language,
				enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_SETTINGS.enabled,
				keyHeight: integer$1(source.keyHeight, DEFAULT_SETTINGS.keyHeight, SETTINGS_LIMITS.keyHeight.min, SETTINGS_LIMITS.keyHeight.max),
				keyGap: integer$1(source.keyGap, DEFAULT_SETTINGS.keyGap, SETTINGS_LIMITS.keyGap.min, SETTINGS_LIMITS.keyGap.max),
				maxVisible: integer$1(source.maxVisible, DEFAULT_SETTINGS.maxVisible, SETTINGS_LIMITS.maxVisible.min, SETTINGS_LIMITS.maxVisible.max)
			};
		}
		function railHeight(settings) {
			return (settings.maxVisible - 1) * settings.keyGap + settings.keyHeight;
		}
		const DEFAULT_SETTINGS_SOURCE = {
			getSnapshot: () => DEFAULT_SETTINGS,
			subscribe: () => () => {}
		};
		//#endregion
		//#region src/client/remote-settings.ts
		/**
		* Remote-backed settings source for the DSH 0.1.7 settings contract.
		* Ported from the upstream 1.2.6 line (2026-09-27): the client-side
		* `settingsScope` service was removed in 0.1.7, so the settings page now
		* reads its entry through `remote.settings.describe()` and writes through
		* `remote.settings.mutate()` instead.
		*/
		const COLOR_SETTING_FIELDS = new Set(Object.values(COLOR_FIELDS));
		/**
		* Keep one remote settings controller per plugin instance. Reads refresh on
		* `settings/document-updated` for this entry only; writes are serialized
		* through a queue and revalidate the entry revision on failure. Consecutive
		* unstarted edits of one color share the latest value and completion promise.
		* Color-only previews publish immediately; a batch may retire only its own
		* still-current previews after confirmation or failure.
		*/
		function createPianoRemoteSettings(remote) {
			let entry;
			let described = false;
			/**
			* Fail-closed value for states where the persisted preference is unknown
			* (loading, or unavailable before the first successful describe): the rail
			* must not claim the native navigator until the stored `enabled` value is
			* known, so a disabled installation is never re-enabled by default.
			*/
			const unknownSettings = () => ({
				...DEFAULT_SETTINGS,
				enabled: false
			});
			let confirmed = unknownSettings();
			let snapshot = {
				status: "loading",
				writable: false,
				revision: 0,
				value: confirmed
			};
			let disposed = false;
			let readGeneration = 0;
			let writeQueue = Promise.resolve();
			const colorPreviews = /* @__PURE__ */ new Map();
			let pendingColor;
			const listeners = /* @__PURE__ */ new Set();
			const sourceListeners = /* @__PURE__ */ new Set();
			const publish = (status, writable) => {
				if (disposed) return;
				let value = confirmed;
				if (status === "ready" && writable && colorPreviews.size > 0) {
					value = { ...confirmed };
					for (const [field, choice] of colorPreviews) value[field] = choice.value;
				}
				const changed = SETTINGS_FIELDS.some((field) => value[field] !== snapshot.value[field]);
				if (!changed) value = snapshot.value;
				const revision = entry?.revision ?? 0, saving = status === "ready" && writable && colorPreviews.size > 0;
				if (!changed && snapshot.status === status && snapshot.writable === writable && snapshot.revision === revision && snapshot.saving === saving) return;
				snapshot = {
					status,
					writable,
					revision,
					value,
					saving
				};
				if (changed) for (const listener of sourceListeners) listener();
				for (const listener of listeners) listener();
			};
			const acceptEntry = (next) => {
				if (next?.revision !== void 0 && entry?.revision !== void 0 && next.revision < entry.revision) return;
				entry = next;
				confirmed = entry === void 0 ? described ? DEFAULT_SETTINGS : unknownSettings() : decodeSettings(entry.value) ?? DEFAULT_SETTINGS;
			};
			const previewColors = (batch) => {
				if (disposed || snapshot.status !== "ready" || !snapshot.writable) return;
				let changed = false;
				for (const op of batch.ops) {
					const value = op.op === "unset" ? "" : op.value;
					if (COLOR_SETTING_FIELDS.has(op.path[0]) && isPianoColor(value)) {
						colorPreviews.set(op.path[0], {
							batch,
							value
						});
						changed = true;
					}
				}
				if (changed) publish(snapshot.status, snapshot.writable);
			};
			const refresh = async () => {
				const generation = ++readGeneration;
				try {
					const response = await remote.settings.describe();
					if (disposed || generation !== readGeneration) return;
					if (!response.ok) throw new Error("settings describe failed");
					const result = response.value;
					described = true;
					acceptEntry(result.namespaces.find((candidate) => candidate.ns === SETTINGS_ENTRY_ID));
					publish(entry === void 0 ? "unavailable" : "ready", entry !== void 0 && result.writable);
				} catch {
					if (disposed || generation !== readGeneration) return;
					publish("unavailable", false);
				}
			};
			const write = (ops, colorField) => {
				if (colorField !== void 0 && pendingColor?.field === colorField) {
					pendingColor.batch.ops = ops;
					previewColors(pendingColor.batch);
					return pendingColor.operation;
				}
				const batch = { ops };
				const operation = writeQueue.then(async () => {
					if (pendingColor?.batch === batch) pendingColor = void 0;
					let committed = false;
					try {
						if (disposed) throw new Error("settings controller disposed");
						if (entry === void 0 || !snapshot.writable) await refresh();
						if (entry === void 0 || !snapshot.writable) throw new Error("settings unavailable");
						const revision = entry.revision ?? 0;
						const response = await remote.settings.mutate(SETTINGS_ENTRY_ID, batch.ops, revision);
						if (!response.ok) throw new Error("settings mutation failed");
						acceptEntry(response.value);
						committed = true;
					} catch (error) {
						if (!disposed) {
							console.warn("[dsh-piano-nav] Settings write failed", error);
							await refresh();
						}
						throw error;
					} finally {
						for (const [field, choice] of colorPreviews) if (choice.batch === batch) colorPreviews.delete(field);
						publish(committed ? "ready" : snapshot.status, snapshot.writable);
					}
				});
				pendingColor = colorField === void 0 ? void 0 : {
					field: colorField,
					batch,
					operation
				};
				writeQueue = operation.catch(() => {});
				previewColors(batch);
				return operation;
			};
			const scope = {
				getSnapshot: () => snapshot,
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				set: (field, value) => write([{
					op: "set",
					path: [field],
					value
				}], COLOR_SETTING_FIELDS.has(field) ? field : void 0),
				unset: (field) => write([{
					op: "unset",
					path: [field]
				}]),
				reset: (fields = SETTINGS_FIELDS) => write(fields.map((field) => ({
					op: "unset",
					path: [field]
				})))
			};
			const source = {
				getSnapshot: () => snapshot.value,
				subscribe(listener) {
					sourceListeners.add(listener);
					return () => {
						sourceListeners.delete(listener);
					};
				}
			};
			const stopListening = remote.$on("settings/document-updated", (ns) => {
				if (ns === "sm-context-piano") refresh();
			});
			refresh();
			return {
				scope,
				source,
				dispose: () => {
					disposed = true;
					readGeneration += 1;
					colorPreviews.clear();
					stopListening();
					listeners.clear();
					sourceListeners.clear();
				}
			};
		}
		//#endregion
		//#region src/client/locales.ts
		const zh = {
			"settings.preview": "实时布局预览",
			"settings.previewDesc": "演示数据。点击灰键展开并连续选择成员，点击其他类型键收回。",
			"settings.folded": "过程组 · 点击展开",
			"settings.first": "查看开头",
			"settings.last": "查看末尾",
			"settings.colors": "琴键颜色与图例",
			"settings.colorsDesc": "配色立即预览并在后台保存，失败时回退；图例与实际琴键同步，自动色随深浅主题切换。",
			"settings.themeColor": "跟随主题",
			"settings.auto": "自动",
			"settings.resetColors": "恢复默认配色",
			"settings.guide": "导航操作说明",
			"settings.guideHistory": "完整历史可通过窗口浏览；未加载轮次沿原生入口加载。最大显示数量只限制窗口内的琴键数，折叠组计一枚。",
			"settings.guideFold": "只有同轮连续过程输出参与折叠。首次点击组展开并定位首条；轨道滚轮浏览保留展开；点击同组成员定位并保持展开，点击其他类型键或另一组时收回旧组。提问、回答、输入、最终结果和历史入口独立显示。",
			"settings.guideKeys": "↑/↓ 选择，PageUp/PageDown 翻窗，Home/End 到首尾，Enter/Space 激活，Escape 收回。轨道滚轮浏览窗口，正文滚动更新阅读位置。",
			"nav.aria": "对话段落快速导航",
			"settings.nav": "琴键导航",
			"settings.subtitle": "语义会话导航 · 完整历史、过程折叠与问答定位。",
			"settings.general": "通用设置",
			"settings.enabled": "已启用",
			"settings.disabled": "已关闭",
			"settings.appearance": "显示设置",
			"settings.height": "琴键粗细",
			"settings.heightDesc": "调整每根琴键横条的高度。",
			"settings.gap": "琴键间距",
			"settings.gapDesc": "调整相邻琴键中心点之间的距离。",
			"settings.maxVisible": "最大显示数量",
			"settings.maxVisibleDesc": "窗口内显示键数上限，折叠组计一枚；不限制历史总量。",
			"settings.totalHeight": "轨道高度上限（实际受可用空间限制）",
			"settings.reset": "恢复默认值",
			"settings.loading": "正在读取设置…",
			"settings.saving": "正在保存配色…",
			"settings.unavailable": "设置暂时不可用，保留已读取值；尚未读取时导航保持关闭。",
			"settings.writeError": "设置保存失败，请稍后重试。",
			"settings.about": "关于插件",
			"settings.version": "版本",
			"settings.releaseDate": "发布日期",
			"settings.author": "作者",
			"settings.feedback": "问题反馈",
			"settings.install": "安装命令",
			"settings.copy": "复制",
			"settings.copied": "已复制",
			"settings.copyError": "复制失败，请手动选择命令。"
		};
		const en = {
			"settings.preview": "Live layout preview",
			"settings.previewDesc": "Demo data. Expand gray keys and select their members; another key kind folds the group.",
			"settings.folded": "Process group · Click to expand",
			"settings.first": "Show first",
			"settings.last": "Show last",
			"settings.colors": "Key colors and legend",
			"settings.colorsDesc": "Colors preview immediately and save in the background, with rollback on failure. The legend and actual keys stay in sync; automatic colors follow the theme.",
			"settings.themeColor": "Follow theme",
			"settings.auto": "Auto",
			"settings.resetColors": "Restore default colors",
			"settings.guide": "Navigation guide",
			"settings.guideHistory": "Browse the full history through the window; unloaded turns use native loading. The visible limit counts displayed keys, with a folded group counting as one.",
			"settings.guideFold": "Only consecutive process outputs in the same turn fold. First activation expands and navigates to the first member; rail wheel browsing preserves expansion. Navigating members keeps that group open. Another key kind or group folds the previous group. Questions, answers, inputs, final results and history entries stay separate.",
			"settings.guideKeys": "↑/↓ select; PageUp/PageDown browse; Home/End go to either end; Enter/Space activate; Escape folds. The rail wheel browses keys; transcript scrolling updates the reading position.",
			"nav.aria": "Conversation paragraph navigator",
			"settings.nav": "Piano Navigator",
			"settings.subtitle": "Semantic navigation · Full history, process groups, questions and answers.",
			"settings.general": "General settings",
			"settings.enabled": "Enabled",
			"settings.disabled": "Disabled",
			"settings.appearance": "Display",
			"settings.height": "Key thickness",
			"settings.heightDesc": "Adjust the height of each horizontal key.",
			"settings.gap": "Key spacing",
			"settings.gapDesc": "Adjust the distance between adjacent key centers.",
			"settings.maxVisible": "Maximum visible keys",
			"settings.maxVisibleDesc": "Maximum displayed keys; a folded group counts as one. Full history remains accessible.",
			"settings.totalHeight": "Rail height limit (available space may reduce it)",
			"settings.reset": "Restore defaults",
			"settings.loading": "Loading settings…",
			"settings.saving": "Saving colors…",
			"settings.unavailable": "Settings unavailable. Retaining loaded values; navigation stays off before the first successful read.",
			"settings.writeError": "Could not save the setting. Try again.",
			"settings.about": "About",
			"settings.version": "Version",
			"settings.releaseDate": "Release date",
			"settings.author": "Author",
			"settings.feedback": "Feedback",
			"settings.install": "Install command",
			"settings.copy": "Copy",
			"settings.copied": "Copied",
			"settings.copyError": "Copy failed. Select the command manually."
		};
		const zhTW = {
			"settings.preview": "即時版面預覽",
			"settings.previewDesc": "示範資料。點擊灰鍵展開並連續選擇成員，點擊其他類型鍵收回。",
			"settings.folded": "過程群組 · 點擊展開",
			"settings.first": "查看開頭",
			"settings.last": "查看末尾",
			"settings.colors": "琴鍵顏色與圖例",
			"settings.colorsDesc": "配色立即預覽並在背景儲存，失敗時回復；圖例與實際琴鍵同步，自動配色隨深淺主題切換。",
			"settings.themeColor": "跟隨主題",
			"settings.auto": "自動",
			"settings.resetColors": "恢復預設配色",
			"settings.guide": "導覽操作說明",
			"settings.guideHistory": "完整歷史可透過視窗瀏覽；未載入輪次沿原生入口載入。最大顯示數量只限制視窗內的琴鍵數，折疊群組計一枚。",
			"settings.guideFold": "只有同輪連續過程輸出參與折疊。首次點擊群組展開並定位首條；軌道滾輪瀏覽保留展開；點擊同群組成員定位並保持展開，點擊其他類型鍵或另一群組時收回舊群組。提問、回答、輸入、最終結果和歷史入口獨立顯示。",
			"settings.guideKeys": "↑/↓ 選擇，PageUp/PageDown 翻窗，Home/End 到首尾，Enter/Space 啟動，Escape 收回。軌道滾輪瀏覽視窗，正文捲動更新閱讀位置。",
			"nav.aria": "對話段落快速導覽",
			"settings.nav": "琴鍵導覽",
			"settings.subtitle": "語義會話導覽 · 完整歷史、過程折疊與問答定位。",
			"settings.general": "通用設定",
			"settings.enabled": "已啟用",
			"settings.disabled": "已關閉",
			"settings.appearance": "顯示設定",
			"settings.height": "琴鍵粗細",
			"settings.heightDesc": "調整每根琴鍵橫條的高度。",
			"settings.gap": "琴鍵間距",
			"settings.gapDesc": "調整相鄰琴鍵中心點之間的距離。",
			"settings.maxVisible": "最大顯示數量",
			"settings.maxVisibleDesc": "視窗內顯示鍵數上限，折疊群組計一枚；不限制歷史總量。",
			"settings.totalHeight": "軌道高度上限（實際受可用空間限制）",
			"settings.reset": "恢復預設值",
			"settings.loading": "正在讀取設定…",
			"settings.saving": "正在儲存配色…",
			"settings.unavailable": "設定暫時無法使用，保留已讀取值；尚未讀取時導覽保持關閉。",
			"settings.writeError": "設定儲存失敗，請稍後再試。",
			"settings.about": "關於外掛",
			"settings.version": "版本",
			"settings.releaseDate": "發布日期",
			"settings.author": "作者",
			"settings.feedback": "問題回饋",
			"settings.install": "安裝命令",
			"settings.copy": "複製",
			"settings.copied": "已複製",
			"settings.copyError": "複製失敗，請手動選取命令。"
		};
		const NS = "sm-context-piano";
		const dictionaries$1 = {
			zh,
			en
		};
		const pluginDictionaries = {
			zh,
			en,
			"zh-TW": zhTW
		};
		function translate(language, key) {
			return pluginDictionaries[language][key];
		}
		//#endregion
		//#region src/client/session-probe.tsx
		/**
		* Session-scoped probe feeding the navigator's current-session source.
		* Ported from the upstream 1.2.6 line (2026-09-27): the 0.1.7 sessions
		* service no longer exposes a selected-session pointer ("navigation belongs
		* to view owners"), so the active Session identity is observed through the
		* conversation header slot instead — only the open conversation's header
		* renders, so the last mounted probe owns the current selection.
		*/
		function createSelectedSessionSource() {
			const listeners = /* @__PURE__ */ new Set();
			let active;
			let current;
			const publish = (next) => {
				if (next === current) return;
				current = next;
				for (const listener of listeners) listener();
			};
			return {
				source: {
					getSnapshot: () => current,
					subscribe(listener) {
						listeners.add(listener);
						return () => {
							listeners.delete(listener);
						};
					}
				},
				activate(sessionId) {
					const token = Symbol();
					active = {
						token,
						sessionId
					};
					publish(sessionId);
					return () => {
						if (active?.token !== token) return;
						active = void 0;
						publish(void 0);
					};
				}
			};
		}
		/** Report the active Session through DSH's session-scoped slot lifecycle. */
		function SessionProbe(props) {
			const { sessionId, activate } = props;
			(0, react.useLayoutEffect)(() => activate(sessionId), [activate, sessionId]);
			return null;
		}
		//#endregion
		//#region assets/icon.png
		var icon_default = "data:image/png;base64,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AkAACAAsCAvCfM1XAAgAAYAFYUGYr/kKAAEgALAgLAjzNV9LXAAIACwIC8J8BQACQABgQVgQ5isAEAACAAtCACAAEAACAAtCACAAEAACQAB4kxcACAABgAAQAAgABIAAQAAIAASA+QoAAYAAEAAIAPMVAAIAASAAMF/zFQACAAEgACwI8zVfASAAEAACwIIwX/MVAAIAAWBBWBDma74CQAAgACwIC8J8zVcACAABgAVhQZiv+QoAASAAsCAsCPM1XwEgAAQAFoQFYb7mKwAEgADAgrAgzNd8BYAAEABYEBaE+QoABIAAwIKwIMxXACAABAAWhABAACAABAAWhABAACAABADe5AUAAkAAIAAEAAIAASAAEAACAAFgvgJAACAABAACwHwFgABAAAgABID5CgABgAAQABaE+ZqvABAACAABYEGYr/kKAAGAALAgLAjzNV8BIAAQABaEBWG+5isABIAAcBAsCAvCfM1XAAgAAYAFYUGYr/kKAAEgALAgLAjzNV8BIAAEABaEBWG+5isABIAAwIKwIMxXACAABAAWhAVhvgIAASAAsCAEgBkJAASAAMCCEAAIAASAAMCCEAAIAAGAABAACAAEgABAAAgABAACQAAgAAQAAsB8BYAAQAAIAASA+QoAAYAAEAAWhPmarwAQAAgAAWBBmK/5CgABgACwICwI8zVfASAAEAAWhAVhvuYrAAQAAsCCsCDM13wFgAAQAFgQFoT5mq8AEAACAAvCgjBf8xUAAkAAYEFYEOZrvgJAAAgALAgLwnwFAAJAAGBBWBDmKwAQAAIAC8KCMCMBgAAQAFgQAgABgAAQAFgQAgABIAAQAAIAAYAAEAAIAAGAAEAACAAEgABAAJivABAACAABgAAwXwEgABAAAsCCMF/zFQACAAEgACwI8zVfASAAEAAWhAVhvuYrAAQAAsCCsCDM13wFgABAAFgQFoT5mq8AEAACAAvCgjBf8xUAAkAAYEFYEOZrvgJAAAgALAgLwnzNVwAIAAGABWFBmK8AsMQFgADAgrAgzFcAIAAEABaEBWG+AgABIACwIAQAAgABIACwIAQAAgA7QAAIAAQAAkAAIAAEAAIAASAAEAACAAFgvgJAACAABAACwHwFgABAAAgAC8J8zVcACAAEgACwIMzXfAWAAEAACAALwnzNVwAIAASABWFBmK/5CgABgACwICwI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";
		//#endregion
		//#region src/client/semantic-style.ts
		const paletteRules = (dark) => SEMANTIC_KINDS.map((kind) => {
			const [normal, active] = THEME_COLORS[dark ? "dark" : "light"][kind];
			const legacy = kind === "input" ? "user" : kind === "final" ? "assistant" : null;
			const normalFallback = legacy ? `var(--smcp-${legacy}-color, ${normal})` : normal;
			const activeFallback = legacy ? `var(--smcp-${legacy}-active-color, ${active})` : active;
			return `${dark ? "body[data-ds-dark-theme] " : ""}.smcp-unified .smcp-bar[data-kind="${kind}"] {
		    --smcp-key: var(--smcp-${kind}-color, ${normalFallback});
		    --smcp-key-active: var(--smcp-${kind}-active-color, ${activeFallback});
		    color: var(--smcp-key); ${kind === "turn" ? "" : "opacity: 1;"}
		  }`;
		}).join("\n");
		const SEMANTIC_CSS = `
		.smcp-unified { --smcp-active-mix: #000; }
		body[data-ds-dark-theme] .smcp-unified { --smcp-active-mix: #fff; }
		${paletteRules(false)}
		${paletteRules(true)}
		/* History uses the same palette in the rail, legend and preview. At 1–2px
		 * height the borders fill the key; transparency does not promise a hollow centre. */
		.smcp-unified .smcp-bar[data-unloaded="true"] {
		  background: transparent;
		  border: 1px solid currentColor;
		  box-sizing: border-box;
		}
		.smcp-unified .smcp-bar[data-unloaded="true"].smcp-bar-current,
		.smcp-unified .smcp-bar[data-unloaded="true"].smcp-bar-hover,
		.smcp-preview-rail .smcp-bar[data-unloaded="true"]:hover {
		  border-color: var(--smcp-key-active);
		}
		body[data-ds-dark-theme] .smcp-tooltip,
		body[data-ds-dark-theme] .smcp-tooltip-title,
		body[data-ds-dark-theme] .smcp-key-label {
		  color: var(--dsw-alias-label-primary, #f1f1f3);
		}
		body[data-ds-dark-theme] .smcp-tooltip-body,
		body[data-ds-dark-theme] .smcp-navigation-status {
		  color: var(--dsw-alias-label-secondary, #b7bac3);
		}
		.smcp-unified .smcp-bar[data-kind="final"] {
		  box-shadow: 0 3px 0 -1px currentColor;
		}
		.smcp-unified .smcp-bar[data-kind="question"],
		.smcp-unified .smcp-bar[data-kind="answer"] { border-radius: 0; }
		.smcp-key-label { display:block;font-size:11px;line-height:18px;font-weight:600; }
		@media (forced-colors: active) {
		  .smcp-unified .smcp-bar { background: ButtonText; border: 1px solid ButtonText; }
		  .smcp-unified .smcp-bar[aria-current="true"] { outline: 2px solid Highlight; }
		}
		`;
		const dictionaries = {
			en: {
				input: "User · Input",
				output: "AI · Output",
				final: "AI · Final result",
				question: "AI · Question",
				answer: "User · Answer",
				turn: "History turn",
				pending: "Awaiting your answer",
				answered: "Answered",
				unanswered: "No valid answer recorded",
				error: "Question cancelled or failed",
				missing: "The target could not be revealed. Retry or open the native transcript."
			},
			zh: {
				input: "用户 · 输入",
				output: "AI · 输出",
				final: "AI · 最终结果",
				question: "AI · 提问",
				answer: "用户 · 回答",
				turn: "历史轮次",
				pending: "等待你回答",
				answered: "已回答",
				unanswered: "未记录有效回答",
				error: "提问已取消或失败",
				missing: "目标暂时无法展开，请重试或查看原生正文。"
			},
			"zh-TW": {
				input: "使用者 · 輸入",
				output: "AI · 輸出",
				final: "AI · 最終結果",
				question: "AI · 提問",
				answer: "使用者 · 回答",
				turn: "歷史輪次",
				pending: "等待你回答",
				answered: "已回答",
				unanswered: "未記錄有效回答",
				error: "提問已取消或失敗",
				missing: "目標暫時無法展開，請重試或查看原生正文。"
			}
		};
		function semanticLabel(item, language) {
			const copy = dictionaries[language];
			return copy[item.kind ?? (item.role === "turn" ? "turn" : item.role === "user" ? "input" : "output")] + (item.interactionState === void 0 ? "" : ` · ${copy[item.interactionState]}`);
		}
		function landingFailure(language) {
			return dictionaries[language].missing;
		}
		//#endregion
		//#region src/client/rail-slots.ts
		/** Locate the display slot containing an original item index. */
		function railSlotIndex(slots, itemIndex) {
			let low = 0, high = slots.length - 1;
			while (low <= high) {
				const middle = low + high >>> 1;
				const slot = slots[middle];
				if (itemIndex < slot.start) high = middle - 1;
				else if (itemIndex >= slot.end) low = middle + 1;
				else return middle;
			}
			return -1;
		}
		function projectRailSlots(items, _activeIndex, expanded, protectedTurns, _collapsed = /* @__PURE__ */ new Set()) {
			const idleOutput = (index) => {
				const item = items[index];
				return item.kind === "output" && item.role === "assistant" && !expanded.has(item.key) && !protectedTurns.has(item.turn);
			};
			const slots = [];
			for (let start = 0; start < items.length;) {
				let end = start + 1;
				if (idleOutput(start)) while (end < items.length && items[end].turn === items[start].turn && idleOutput(end)) end++;
				const sourceIndex = start + Math.floor((end - start - 1) / 2);
				slots.push({
					item: items[sourceIndex],
					sourceIndex,
					displayIndex: slots.length,
					start,
					end
				});
				start = end;
			}
			return slots;
		}
		//#endregion
		//#region src/client/chat-source.ts
		/**
		* Keep one subscription per materialized key.
		*
		* Structural target publications rebuild the ordered projection. Keyed source
		* publications refresh only the affected nodes, instead of walking every key in
		* a long transcript for each streaming token.
		*/
		function observeChatNodes(source, publish, schedule = queueMicrotask) {
			let alive = true;
			let queued = false;
			let structureDirty = false;
			const keyedDirty = /* @__PURE__ */ new Set();
			let unsubscribeTarget = () => {};
			const subscriptions = /* @__PURE__ */ new Map();
			let orderedKeys = [];
			let orderedNodes = [];
			let indexByKey = /* @__PURE__ */ new Map();
			let orderIdentity;
			let storeIdentity;
			let navigationIdentity;
			const dispose = () => {
				if (!alive) return;
				alive = false;
				unsubscribeTarget();
				for (const entry of subscriptions.values()) entry.dispose();
				subscriptions.clear();
				keyedDirty.clear();
				orderedKeys = [];
				orderedNodes = [];
				indexByKey.clear();
				orderIdentity = void 0;
				storeIdentity = void 0;
				navigationIdentity = void 0;
			};
			const enqueue = () => {
				if (!alive || queued) return;
				queued = true;
				schedule(() => {
					queued = false;
					if (!alive) return;
					if (structureDirty) {
						structureDirty = false;
						const keys = [...keyedDirty];
						keyedDirty.clear();
						if (!reconcileStructure() && keys.length > 0) refreshKeys(keys);
					} else if (keyedDirty.size > 0) {
						const keys = [...keyedDirty];
						keyedDirty.clear();
						refreshKeys(keys);
					}
				});
			};
			const requestStructure = () => {
				structureDirty = true;
				enqueue();
			};
			const requestKey = (key) => {
				keyedDirty.add(key);
				enqueue();
			};
			const bindKey = (snapshot, key) => {
				const nodeSource = snapshot.nodes.source(key);
				const previous = subscriptions.get(key);
				if (previous?.source === nodeSource) return;
				previous?.dispose();
				subscriptions.set(key, {
					source: nodeSource,
					dispose: nodeSource.subscribe(() => requestKey(key))
				});
			};
			const reconcileStructure = () => {
				const snapshot = source.getSnapshot();
				if (snapshot !== void 0 && snapshot.order === orderIdentity && snapshot.nodes === storeIdentity) {
					const navigation = snapshot.navigation?.items();
					if (navigation !== navigationIdentity) {
						navigationIdentity = navigation;
						publish(orderedNodes, "navigation");
					}
					return false;
				}
				const nextOrder = snapshot?.order ?? [];
				const remaining = new Set(nextOrder);
				for (const [key, entry] of subscriptions) if (!remaining.has(key)) {
					entry.dispose();
					subscriptions.delete(key);
				}
				const nextKeys = [];
				const nextNodes = [];
				const nextIndex = /* @__PURE__ */ new Map();
				if (snapshot !== void 0) for (const key of nextOrder) {
					bindKey(snapshot, key);
					const node = snapshot.nodes.get(key);
					if (node === void 0) continue;
					nextIndex.set(key, nextNodes.length);
					nextKeys.push(key);
					nextNodes.push(node);
				}
				orderedKeys = nextKeys;
				orderedNodes = nextNodes;
				indexByKey = nextIndex;
				orderIdentity = snapshot?.order;
				storeIdentity = snapshot?.nodes;
				navigationIdentity = snapshot?.navigation?.items();
				publish(orderedNodes, "structure");
				return true;
			};
			const refreshKeys = (keys) => {
				const snapshot = source.getSnapshot();
				if (snapshot === void 0) {
					reconcileStructure();
					return;
				}
				for (const key of keys) {
					const index = indexByKey.get(key);
					if (index === void 0 || orderedKeys[index] !== key) {
						reconcileStructure();
						return;
					}
					try {
						bindKey(snapshot, key);
						const node = snapshot.nodes.get(key);
						if (node === void 0) {
							reconcileStructure();
							return;
						}
						orderedNodes[index] = node;
					} catch {
						reconcileStructure();
						return;
					}
				}
				publish(orderedNodes, "keyed", keys);
			};
			try {
				unsubscribeTarget = source.subscribe(requestStructure);
				reconcileStructure();
			} catch (error) {
				dispose();
				throw error;
			}
			return dispose;
		}
		//#endregion
		//#region src/client/question-keys.ts
		const MAX_JSON_LENGTH = 262144;
		const MAX_CALLS = 4096;
		/** Counts only: never retain call ids, prompts, arguments, or answer text. */
		function createQuestionDiagnostics() {
			return {
				toolNodes: 0,
				calls: 0,
				duplicateCallIds: 0,
				missingCallHead: 0,
				scanLimited: 0,
				askCalls: 0,
				missingTurn: 0,
				invalidQuestions: 0,
				invalidResults: 0,
				pending: 0,
				answered: 0,
				unanswered: 0,
				error: 0,
				questionKeys: 0,
				answerKeys: 0
			};
		}
		const object = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
		const text = (value) => typeof value === "string" ? value : "";
		const bounded = (value, limit) => value.length <= limit ? value : `${value.slice(0, limit).trimEnd()}…`;
		function parse(value) {
			if (typeof value !== "string" || value.length > MAX_JSON_LENGTH) return null;
			try {
				return object(JSON.parse(value));
			} catch {
				return null;
			}
		}
		function uniqueById(values) {
			const result = /* @__PURE__ */ new Map();
			const duplicates = /* @__PURE__ */ new Set();
			for (const value of values) {
				const entry = object(value), id = text(entry?.id);
				if (entry === null || id === "" || duplicates.has(id)) continue;
				if (result.has(id)) {
					result.delete(id);
					duplicates.add(id);
				} else result.set(id, entry);
			}
			return result;
		}
		function resultObject(call) {
			if (call.kind !== "tool-result" || call.isError !== false || !Array.isArray(call.content)) return null;
			let raw = "";
			for (const value of call.content) {
				const block = object(value);
				if (block?.type !== "text" || typeof block.text !== "string") continue;
				if (raw.length + block.text.length > MAX_JSON_LENGTH) return null;
				raw += block.text;
			}
			return parse(raw);
		}
		/** Census precedes emission: no first-wins answers from duplicate call identities. */
		function uniqueCalls(nodes, diagnostic) {
			const calls = /* @__PURE__ */ new Map();
			const duplicates = /* @__PURE__ */ new Set();
			for (const node of nodes) {
				if (node.kind !== "tool-call") continue;
				if (diagnostic) diagnostic.toolNodes++;
				const root = object(object(node.data)?.root);
				if (root === null) continue;
				const visited = /* @__PURE__ */ new Set();
				const stack = [root];
				while (stack.length > 0) {
					if (visited.size >= MAX_CALLS) {
						if (diagnostic) diagnostic.scanLimited++;
						return /* @__PURE__ */ new Map();
					}
					const call = stack.pop();
					if (visited.has(call)) continue;
					visited.add(call);
					if (diagnostic) {
						diagnostic.calls++;
						if (call.kind === "tool-result" && object(call.call) === null) diagnostic.missingCallHead++;
					}
					const id = text(call.callId);
					if (id !== "" && !duplicates.has(id)) if (calls.has(id)) {
						calls.delete(id);
						duplicates.add(id);
						if (diagnostic) diagnostic.duplicateCallIds++;
					} else calls.set(id, {
						node,
						call
					});
					if (Array.isArray(call.subCalls)) {
						if (call.subCalls.length > MAX_CALLS) {
							if (diagnostic) diagnostic.scanLimited++;
							return /* @__PURE__ */ new Map();
						}
						for (let i = call.subCalls.length - 1; i >= 0; i--) {
							const child = object(call.subCalls[i]);
							if (child !== null) stack.push(child);
						}
					}
				}
			}
			return calls;
		}
		function buildQuestionKeys(nodes, locate, diagnostic) {
			const byNode = /* @__PURE__ */ new Map();
			for (const [callId, { node, call }] of uniqueCalls(nodes, diagnostic)) {
				const turn = locate(node);
				const head = call.kind === "tool-result" ? object(call.call) : call;
				if (head?.name !== "ask_user_question") continue;
				if (diagnostic) diagnostic.askCalls++;
				if (turn === null) {
					if (diagnostic) diagnostic.missingTurn++;
					continue;
				}
				const args = parse(head.argsRaw);
				if (!Array.isArray(args?.questions)) {
					if (diagnostic) diagnostic.invalidQuestions++;
					continue;
				}
				const result = resultObject(call);
				const answers = uniqueById(Array.isArray(result?.answers) ? result.answers : []);
				const settled = call.kind === "tool-result";
				if (diagnostic && settled && call.isError !== true && (call.isError !== false || !Array.isArray(result?.answers))) diagnostic.invalidResults++;
				const output = byNode.get(node.key) ?? [];
				const previousLength = output.length;
				byNode.set(node.key, output);
				for (const [id, question] of uniqueById(args.questions)) {
					const prompt = text(question.question).trim();
					if (prompt === "") continue;
					const candidate = answers.get(id), selected = candidate?.selected;
					const valid = candidate !== void 0 && Array.isArray(selected) && selected.every((value) => typeof value === "string") && (candidate.custom === void 0 || typeof candidate.custom === "string");
					const custom = valid ? text(candidate.custom).trim() : "";
					const selections = valid ? selected.filter((value) => value.trim() !== "") : [];
					const answerText = valid ? (custom !== "" && question.multi_select !== true ? custom : [...selections, ...custom !== "" ? [custom] : []].join("\n")).trim() : "";
					const answered = valid && answerText !== "" && settled && call.isError === false;
					const interactionState = !settled ? "pending" : call.isError === true ? "error" : answered ? "answered" : "unanswered";
					if (diagnostic) {
						diagnostic[interactionState]++;
						diagnostic.questionKeys++;
						if (answered) diagnostic.answerKeys++;
					}
					const base = `question:${encodeURIComponent(callId)}:${encodeURIComponent(id)}`;
					const options = Array.isArray(question.options) ? question.options.flatMap((value) => {
						const label = text(object(value)?.label);
						return label !== "" ? [label] : [];
					}).join(" / ") : "";
					output.push({
						key: base,
						anchorKey: `call:${callId}`,
						turn,
						role: "assistant",
						kind: "question",
						interactionState,
						title: bounded(prompt, 140),
						preview: bounded(prompt + (options !== "" ? `\n${options}` : ""), 520)
					});
					if (answered) output.push({
						key: `${base}:answer`,
						anchorKey: `call:${callId}`,
						turn,
						role: "user",
						kind: "answer",
						interactionState: "answered",
						title: bounded(answerText, 140),
						preview: bounded(`${prompt}\n${answerText}`, 520)
					});
				}
				if (diagnostic && output.length === previousLength) diagnostic.invalidQuestions++;
			}
			return byNode;
		}
		//#endregion
		//#region src/client/keys.ts
		const PREVIEW_LIMIT = 520;
		const TITLE_LIMIT = 140;
		const USER_KINDS = /* @__PURE__ */ new Set(["user", "steering"]);
		const ASSISTANT_KINDS = /* @__PURE__ */ new Set(["assistant", "assistant-step"]);
		const record = (value) => typeof value === "object" && value !== null ? value : {};
		const integer = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
		function truncate(text, limit) {
			const normalized = text.replace(/\r\n?/g, "\n").trim();
			return normalized.length <= limit ? normalized : `${normalized.slice(0, limit).trimEnd()}…`;
		}
		function titleOf(text) {
			return truncate((text.split("\n").find((line) => line.trim() !== "") ?? "…").replace(/^\s*(?:#{1,6}|>|[-*+] |\d+[.)]\s*)\s*/, ""), TITLE_LIMIT);
		}
		function contentText(blocks) {
			return blocks.flatMap((value) => {
				const block = record(value);
				return block.type === "text" && typeof block.text === "string" ? [block.text] : block.type === "image" ? ["[image]"] : block.type === "file" ? ["[file]"] : [];
			}).join("\n");
		}
		/** Modern locations hold a TurnLocation object, not a numeric turn. */
		function turnOf(node) {
			const location = record(node.location);
			const located = typeof location.turn === "object" ? record(location.turn).turn : location.turn;
			if (integer(located)) return located;
			const turn = record(node.data).turn;
			return integer(turn) ? turn : null;
		}
		function outputRuns(data) {
			if (!Array.isArray(data.blocks)) {
				const text = Array.isArray(data.content) ? contentText(data.content).trim() : "";
				return {
					runs: text ? [text] : [],
					startsWithText: text !== "",
					endsWithText: text !== ""
				};
			}
			const runs = [];
			let current = [];
			const flush = () => {
				const text = current.join("\n").trim();
				if (text !== "") runs.push(text);
				current = [];
			};
			for (const value of data.blocks) {
				const block = record(value);
				if (block.kind === "text" && typeof block.text === "string" && block.text.trim() !== "") current.push(block.text);
				else if (block.kind === "image") current.push("[image]");
				else flush();
			}
			flush();
			return {
				runs,
				startsWithText: record(data.blocks[0]).kind === "text",
				endsWithText: record(data.blocks.at(-1)).kind === "text"
			};
		}
		function descriptor(node, role, text, kind, suffix = "") {
			const preview = truncate(text, PREVIEW_LIMIT);
			return {
				key: `${node.key}${suffix}`,
				anchorKey: node.key,
				role,
				title: titleOf(preview),
				preview,
				turn: turnOf(node),
				kind,
				...kind === "output" && node.visibility === "hidden" ? { folded: true } : {}
			};
		}
		/** A completed model step alone does not establish the final Turn answer. */
		function finalKeys(nodes) {
			const closing = /* @__PURE__ */ new Map();
			const failed = /* @__PURE__ */ new Set();
			for (const node of nodes) {
				const turn = turnOf(node);
				if (turn === null) continue;
				if (node.kind === "turn-error" || node.kind === "turn-max-tokens") failed.add(turn);
				if (node.kind !== "turn-tail") continue;
				const tail = record(record(node.data).closing);
				const durable = record(tail.finalNode);
				if (tail.status === "settled" && integer(tail.step) && durable.interrupted !== true && durable.kind === "assistant" && integer(durable.seq)) closing.set(turn, tail);
			}
			const candidates = /* @__PURE__ */ new Map();
			for (const node of nodes) {
				const turn = turnOf(node);
				if (turn === null || failed.has(turn) || !ASSISTANT_KINDS.has(node.kind)) continue;
				const tail = closing.get(turn);
				if (tail === void 0) continue;
				const data = record(node.data);
				const durable = node.kind === "assistant" ? data : record(data.finalNode);
				const expected = record(tail.finalNode);
				if (data.status === "running" || data.status === "interrupted" || durable.interrupted === true) continue;
				if (data.step !== tail.step || durable.seq !== expected.seq) continue;
				if (typeof expected.messageId === "string" && durable.messageId !== expected.messageId) continue;
				if (outputRuns(data).runs.length === 0) continue;
				const list = candidates.get(turn) ?? [];
				list.push(node);
				candidates.set(turn, list);
			}
			return new Set([...candidates.values()].filter((list) => list.length === 1).map((list) => list[0].key));
		}
		function buildNavigationNodesWithQuestions(nodes, questions) {
			const finals = finalKeys(nodes);
			const result = [];
			let continuable = null;
			for (const node of nodes) {
				const hidden = node.visibility === "hidden";
				if (hidden) {
					continuable = null;
					if (!ASSISTANT_KINDS.has(node.kind) && node.kind !== "tool-call") continue;
				}
				const data = record(node.data);
				if (USER_KINDS.has(node.kind)) {
					continuable = null;
					const text = Array.isArray(data.content) ? contentText(data.content).trim() : "";
					if (text !== "") result.push(descriptor(node, "user", text, "input"));
					continue;
				}
				if (node.kind === "tool-call") {
					continuable = null;
					result.push(...questions.get(node.key) ?? []);
					continue;
				}
				if (!ASSISTANT_KINDS.has(node.kind)) {
					continuable = null;
					continue;
				}
				const output = outputRuns(data);
				if (output.runs.length === 0) {
					continuable = null;
					continue;
				}
				if (finals.has(node.key)) {
					result.push(descriptor(node, "assistant", output.runs.join("\n\n"), "final", "::output:0"));
					continuable = null;
					continue;
				}
				for (let index = 0; index < output.runs.length; index++) {
					const turn = turnOf(node);
					const target = index === 0 && output.startsWithText && continuable !== null && turn !== null && continuable.turn === turn ? continuable : null;
					if (target !== null) target.preview = truncate(`${target.preview}\n\n${output.runs[index]}`, PREVIEW_LIMIT);
					else {
						const next = descriptor(node, "assistant", output.runs[index], "output", `::output:${index}`);
						result.push(next);
						continuable = next;
					}
					if (index < output.runs.length - 1) continuable = null;
				}
				if (hidden || !output.endsWithText) continuable = null;
			}
			return result;
		}
		//#endregion
		//#region src/client/navigation-model.ts
		const validNumber = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
		const preview = (value) => typeof value === "string" ? value.slice(0, 520) : "";
		function mergeNavigationTurns(loaded, outline) {
			const turns = /* @__PURE__ */ new Map();
			if (Array.isArray(outline)) for (const raw of outline) {
				if (raw === null || typeof raw !== "object") continue;
				const entry = raw;
				if (!validNumber(entry.turn) || !validNumber(entry.seq)) continue;
				turns.set(entry.turn, {
					turn: entry.turn,
					prompt: preview(entry.prompt),
					response: preview(entry.response),
					anchor: {
						kind: "unloaded",
						seq: entry.seq
					}
				});
			}
			for (const item of loaded) {
				if (!validNumber(item.turn) || typeof item.anchorKey !== "string" || item.anchorKey === "") continue;
				const old = turns.get(item.turn);
				turns.set(item.turn, {
					turn: item.turn,
					prompt: preview(item.prompt) || old?.prompt || "",
					response: preview(item.response) || old?.response || "",
					anchor: {
						kind: "loaded",
						key: item.anchorKey
					}
				});
			}
			return [...turns.values()].sort((a, b) => a.turn - b.turn);
		}
		function buildPianoItemsForTurn(turn, segments, label) {
			const children = turn.anchor.kind === "loaded" ? segments.filter((segment) => segment.turn === turn.turn) : [];
			if (children.length === 0) return [{
				key: `turn:${turn.turn}`,
				turn: turn.turn,
				title: turn.prompt || label(turn.turn),
				preview: turn.response,
				role: "turn",
				anchorKey: turn.anchor.kind === "loaded" ? turn.anchor.key : null
			}];
			return children.map((segment, index) => ({
				key: index === 0 ? `turn:${turn.turn}` : `segment:${segment.key}`,
				turn: turn.turn,
				title: segment.title,
				preview: segment.preview,
				role: segment.role,
				anchorKey: segment.anchorKey,
				kind: segment.kind,
				interactionState: segment.interactionState,
				...segment.folded === true ? { folded: true } : {}
			}));
		}
		function buildPianoItems(turns, segments, label) {
			const grouped = /* @__PURE__ */ new Map();
			for (const segment of segments) {
				if (segment.turn === null) continue;
				const list = grouped.get(segment.turn) ?? [];
				list.push(segment);
				grouped.set(segment.turn, list);
			}
			return turns.flatMap((turn) => buildPianoItemsForTurn(turn, grouped.get(turn.turn) ?? [], label));
		}
		//#endregion
		//#region src/client/native-navigation.ts
		function createNativeNavigation(flow, labels) {
			const local = flow.parentElement;
			const scrollport = flow.closest("[data-conversation-scroll]") ?? local;
			let nav = null;
			let saved;
			let emptyWindow = 0;
			let buttons = /* @__PURE__ */ new Map();
			let turns = [];
			let rows = /* @__PURE__ */ new Map();
			let orderedRows = [];
			let mappedAnchors = /* @__PURE__ */ new Set();
			let mappedRows = [];
			let issuedUnloaded = false;
			const readerPointer = (event) => {
				if (event.target?.closest("input,textarea,select,[contenteditable=\"true\"]") != null) return;
				api.cancel();
			};
			const refreshRows = () => {
				rows = /* @__PURE__ */ new Map();
				orderedRows = [];
				for (const row of flow.querySelectorAll("[data-chat-anchor-key]")) {
					if (row.dataset.chatAnchorKey === void 0 || row.closest("[hidden]") !== null) continue;
					rows.set(row.dataset.chatAnchorKey, row);
					orderedRows.push(row);
				}
				mappedRows = orderedRows.filter((row) => mappedAnchors.has(row.dataset.chatAnchorKey ?? ""));
			};
			const setMappedAnchors = (anchors) => {
				mappedAnchors = new Set(anchors);
				mappedRows = orderedRows.filter((row) => mappedAnchors.has(row.dataset.chatAnchorKey ?? ""));
			};
			const release = () => {
				issuedUnloaded = false;
				scrollport?.removeEventListener("pointerdown", readerPointer);
				if (saved === void 0) return;
				const old = saved;
				saved = void 0;
				if (old.nav.style.getPropertyValue("visibility") === "hidden" && old.nav.style.getPropertyPriority("visibility") === "important") if (old.visibility) old.nav.style.setProperty("visibility", old.visibility, old.priority);
				else old.nav.style.removeProperty("visibility");
				if (old.nav.getAttribute("aria-hidden") === "true") if (old.aria === null) old.nav.removeAttribute("aria-hidden");
				else old.nav.setAttribute("aria-hidden", old.aria);
			};
			const rowFor = (key) => {
				const row = rows.get(key);
				return row?.isConnected && row.closest("[hidden]") === null ? row : null;
			};
			const anchorAtOrBefore = (clientY) => {
				let low = 0;
				let high = mappedRows.length - 1;
				let chosen = null;
				while (low <= high) {
					const middle = low + high >>> 1;
					const row = mappedRows[middle];
					if (!row.isConnected || row.closest("[hidden]") !== null) {
						refreshRows();
						return anchorAtOrBefore(clientY);
					}
					if (row.getBoundingClientRect().top <= clientY) {
						chosen = row;
						low = middle + 1;
					} else high = middle - 1;
				}
				return chosen?.dataset.chatAnchorKey ?? null;
			};
			const flushReaderPosition = () => {
				scrollport?.dispatchEvent(new Event("scroll"));
				scrollport?.dispatchEvent(new Event("scrollend"));
			};
			const busy = () => {
				for (const [turn, button] of buttons) if (button.getAttribute("aria-busy") === "true") return turn;
				return null;
			};
			/** Whether ANY official button is mid-load, including ones virtualized out
			*  of our partial map (Piano-issued or native-issued jumps alike). The
			*  cancellation gate must not depend on map visibility. */
			const hasNativeBusy = () => nav !== null && nav.querySelector("button[aria-busy=\"true\"]") !== null;
			let emptySince = null;
			let emptyRecheckScheduled = false;
			const api = {
				rowFor,
				setMappedAnchors,
				anchorAtOrBefore,
				release,
				busy,
				/** Why the most recent reconcile refused takeover; null when it accepted. */
				lastReject: null,
				/** How many turns the most recent reconcile left unmapped (virtualized-out buttons); null when none. */
				lastSkip: null,
				/** Set by the strip: a self-driven recheck (empty-window hold) changed
				*  the takeover state outside the strip's render flow, so its cached
				*  nativeReady/mode is stale and it must schedule a re-render. Passive
				*  reconcile calls from the strip itself do NOT fire this. */
				onExternalReconcile: null,
				/** While holding an empty virtualizer window, drive the recheck ourselves:
				*  child-list mutations stop firing once every button is gone, so nobody
				*  else would re-run reconcile to notice the refill or the deadline. */
				scheduleEmptyRecheck() {
					if (emptyRecheckScheduled) return;
					emptyRecheckScheduled = true;
					(typeof requestAnimationFrame === "function" ? requestAnimationFrame : (callback) => {
						setTimeout(() => callback(performance.now()), 16);
						return 0;
					})(() => {
						emptyRecheckScheduled = false;
						if (saved !== void 0) {
							api.reconcile(turns);
							api.onExternalReconcile?.();
						}
					});
				},
				/** One row scan per publication, never one scan per mark. */
				reconcile(next) {
					refreshRows();
					turns = next;
					const surfaces = [...(scrollport ?? local)?.querySelectorAll("nav,[role=\"navigation\"]") ?? []].filter((element) => !flow.contains(element));
					const candidates = surfaces.filter((element) => element.getAttribute("aria-label") === labels.navigation());
					const candidate = surfaces.length === 1 && candidates.length === 1 ? candidates[0] : null;
					if (surfaces.length !== 1) api.lastReject = `surfaces:${surfaces.length}`;
					else if (candidate === null) api.lastReject = "label-mismatch";
					const nextButtons = /* @__PURE__ */ new Map();
					if (candidate !== null) {
						const all = [...candidate.querySelectorAll("button")];
						const byLabel = /* @__PURE__ */ new Map();
						for (const button of all) {
							const label = button.getAttribute("aria-label") ?? "";
							const entries = byLabel.get(label) ?? [];
							entries.push(button);
							byLabel.set(label, entries);
						}
						let skipped = 0;
						const claimed = /* @__PURE__ */ new Set();
						const plentiful = all.length >= turns.length;
						for (const turn of turns) {
							const primary = byLabel.get(labels.jump(turn.turn, turn.anchor.kind === "unloaded")) ?? [];
							const alternate = byLabel.get(labels.jump(turn.turn, turn.anchor.kind !== "unloaded")) ?? [];
							for (const list of [primary, alternate]) for (const button of list) claimed.add(button);
							let button = null;
							let absent = true;
							let rendered = 0;
							for (const list of [primary, alternate]) {
								if (list.length === 0) continue;
								absent = false;
								rendered += list.length;
								if (list.length === 1 && !list[0].disabled) {
									button = list[0];
									break;
								}
							}
							if (button !== null) {
								nextButtons.set(turn.turn, button);
								continue;
							}
							if (absent && !plentiful) {
								skipped++;
								continue;
							}
							const sole = rendered === 1 ? primary[0] ?? alternate[0] : null;
							if (sole !== null && sole.getAttribute("aria-busy") === "true") {
								skipped++;
								continue;
							}
							api.lastReject = `button-match:turn${turn.turn}:${rendered}:${turn.anchor.kind}`;
							release();
							nav = null;
							buttons.clear();
							return false;
						}
						for (const button of all) {
							if (claimed.has(button)) continue;
							api.lastReject = `button-match:unrecognized:${all.length}`;
							release();
							nav = null;
							buttons.clear();
							return false;
						}
						api.lastSkip = skipped === 0 ? null : `skipped:${skipped}`;
						if (nextButtons.size === 0) {
							const empty = all.length === 0 && skipped === turns.length && turns.length > 0;
							const now = performance.now();
							if (empty && (emptySince === null ? (emptySince = now, true) : now - emptySince < 1500)) {
								emptyWindow++;
								api.lastSkip = `empty-window:${emptyWindow}`;
								api.lastReject = null;
								api.scheduleEmptyRecheck();
								if (candidate === nav) return true;
								release();
								nav = null;
								buttons.clear();
								return false;
							}
							api.lastReject = `button-match:none:skipped${skipped}`;
							emptySince = null;
							release();
							nav = null;
							buttons.clear();
							return false;
						}
						emptyWindow = 0;
						emptySince = null;
					} else if (surfaces.length !== 0 || turns.length > 1 || turns.some((turn) => turn.anchor.kind === "unloaded")) {
						if (api.lastReject === null) api.lastReject = `absent-nav:turns${turns.length}`;
						release();
						nav = null;
						buttons.clear();
						return false;
					}
					if (candidate !== nav) release();
					nav = candidate;
					buttons = nextButtons;
					issuedUnloaded = false;
					api.lastReject = null;
					return true;
				},
				claim() {
					if (nav === null || saved?.nav === nav) return;
					saved = {
						nav,
						visibility: nav.style.getPropertyValue("visibility"),
						priority: nav.style.getPropertyPriority("visibility"),
						aria: nav.getAttribute("aria-hidden")
					};
					nav.style.setProperty("visibility", "hidden", "important");
					nav.setAttribute("aria-hidden", "true");
					if (nav.querySelector("button") === null && turns.length > 0) {
						if (emptySince === null) emptySince = performance.now();
						api.scheduleEmptyRecheck();
					}
					scrollport?.addEventListener("pointerdown", readerPointer, { passive: true });
				},
				active() {
					for (const [turn, button] of buttons) if (button.getAttribute("aria-current") === "true") return turn;
					return null;
				},
				/** Whether the official surface currently renders a live button for this turn
				*  (false while virtualization keeps it outside the rendered window). */
				hasButton(turn) {
					return buttons.get(turn)?.isConnected === true;
				},
				navigate(turn, anchorKey) {
					if (scrollport === null || !flow.isConnected) return false;
					refreshRows();
					const button = buttons.get(turn);
					const row = anchorKey === null ? null : rowFor(anchorKey);
					if (button?.isConnected) {
						if (saved === void 0) return false;
						issuedUnloaded = anchorKey === null;
						button.click();
					} else if (row === null) return false;
					if (row !== null) {
						scrollport.scrollTop += row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top - 24;
						flushReaderPosition();
					}
					return true;
				},
				/** Cancel landing, not shared network I/O, through the native superseding action. */
				cancel() {
					if (saved === void 0 || scrollport === null || !issuedUnloaded && !hasNativeBusy()) return;
					refreshRows();
					const top = scrollport.scrollTop;
					const line = scrollport.getBoundingClientRect().top + 24;
					let chosen;
					for (const turn of turns) {
						if (turn.anchor.kind !== "loaded" || !buttons.get(turn.turn)?.isConnected) continue;
						const row = rowFor(turn.anchor.key);
						if (row === null) continue;
						const distance = Math.abs(row.getBoundingClientRect().top - line);
						if (chosen === void 0 || distance < chosen.distance) chosen = {
							turn: turn.turn,
							distance
						};
					}
					if (chosen !== void 0) {
						issuedUnloaded = false;
						buttons.get(chosen.turn)?.click();
						scrollport.scrollTop = top;
						flushReaderPosition();
					}
				}
			};
			return api;
		}
		//#endregion
		//#region src/client/semantic-landing.ts
		function createSemanticLanding(flow, owner) {
			let generation = 0;
			let abort;
			let anchors = /* @__PURE__ */ new Map();
			const refresh = () => {
				anchors = /* @__PURE__ */ new Map();
				for (const element of flow.querySelectorAll("[data-chat-anchor-key]")) {
					const key = element.dataset.chatAnchorKey;
					if (key !== void 0) anchors.set(key, element);
				}
			};
			const rawRow = (key) => {
				const row = anchors.get(key);
				return row?.isConnected ? row : null;
			};
			const allowedHidden = (row) => {
				for (let element = row; element !== null; element = element.parentElement) {
					if (element.hasAttribute("hidden") && (element.getAttribute("hidden") !== "until-found" || !flow.contains(element) || element.dataset.turnProcessHidden !== "true")) return false;
					if (element === flow) break;
				}
				return flow.closest("[hidden]") === null;
			};
			const cancel = () => {
				generation++;
				abort?.abort();
				abort = void 0;
			};
			const frame = (signal) => new Promise((resolve) => {
				if (signal.aborted) {
					resolve(false);
					return;
				}
				let done = false;
				let raf = 0;
				let timer = 0;
				const finish = (value) => {
					if (done) return;
					done = true;
					window.cancelAnimationFrame(raf);
					window.clearTimeout(timer);
					signal.removeEventListener("abort", onAbort);
					resolve(value);
				};
				const onAbort = () => {
					finish(false);
				};
				signal.addEventListener("abort", onAbort, { once: true });
				raf = window.requestAnimationFrame(() => {
					finish(true);
				});
				timer = window.setTimeout(() => {
					finish(false);
				}, 1500);
			});
			return {
				refresh,
				cancel,
				canReveal(key) {
					const row = rawRow(key);
					return row !== null && allowedHidden(row);
				},
				async navigate(item) {
					cancel();
					const ticket = generation;
					const interactive = item.kind === "question" || item.kind === "answer";
					if (!interactive && item.kind !== "output" && item.kind !== "final") return owner.navigate(item.turn, item.anchorKey);
					if (item.anchorKey === null) return owner.navigate(item.turn, null);
					owner.cancel();
					const controller = new AbortController();
					abort = controller;
					const valid = () => generation === ticket && !controller.signal.aborted && flow.isConnected;
					try {
						refresh();
						let row = rawRow(item.anchorKey);
						if (row === null || !allowedHidden(row)) return false;
						for (let attempt = 0; attempt < 8; attempt++) {
							if (!valid()) return void 0;
							const hidden = row.closest("[hidden]");
							if (hidden === null) break;
							if (hidden.getAttribute("hidden") !== "until-found" || hidden.dataset.turnProcessHidden !== "true") return false;
							hidden.dispatchEvent(new Event("beforematch"));
							if (!await frame(controller.signal)) return valid() ? false : void 0;
							refresh();
							row = rawRow(item.anchorKey);
							if (row === null) return false;
						}
						if (!valid()) return void 0;
						if (row.closest("[hidden]") !== null) return false;
						if (!interactive) return owner.navigate(item.turn, item.anchorKey);
						const callId = item.anchorKey.startsWith("call:") ? item.anchorKey.slice(5) : "";
						if (callId === "" || row.dataset.chatCallId !== callId) return false;
						const card = [...row.querySelectorAll("[data-tool=\"ask_user_question\"]")].find((element) => element.closest("[data-chat-call-id]") === row);
						if (card === void 0) return false;
						const headers = [...card.querySelectorAll("[data-disclosure-row][data-expandable=\"true\"][role=\"button\"][aria-expanded]")].filter((element) => element.closest("[data-tool]") === card);
						if (headers.length !== 1) return false;
						if (headers[0].getAttribute("aria-expanded") === "false") {
							headers[0].click();
							if (!await frame(controller.signal)) return valid() ? false : void 0;
						}
						if (!valid()) return void 0;
						refresh();
						row = rawRow(item.anchorKey);
						if (row === null || row.closest("[hidden]") !== null) return false;
						if (row.querySelector("[data-tool=\"ask_user_question\"] [data-disclosure-row][aria-expanded=\"true\"]") === null) return false;
						return owner.navigate(item.turn, item.anchorKey);
					} catch {
						return valid() ? false : void 0;
					} finally {
						if (abort === controller) abort = void 0;
					}
				}
			};
		}
		function createPointerWave() {
			let anchor = null;
			let from = 0;
			let target = 0;
			let started = 0;
			const sample = (now, reducedMotion = false) => {
				const progress = reducedMotion ? 1 : Math.max(0, Math.min(1, (now - started) / 96));
				const strength = from + (target - from) * (1 - (1 - progress) ** 3);
				const moving = !reducedMotion && from !== target && progress < 1;
				if (!moving) {
					from = target;
					if (target === 0) anchor = null;
				}
				return {
					anchor,
					strength: moving ? strength : target,
					moving
				};
			};
			return {
				sample,
				point(next, now, reducedMotion = false, paintedStrength = 0) {
					let current = sample(now, reducedMotion).strength;
					if (next !== null && anchor === null) current = Math.max(-1, Math.min(1, paintedStrength));
					if (next !== null) anchor = next;
					const desired = next === null ? 0 : 1;
					if (desired === target) return;
					from = current;
					target = desired;
					started = now;
				},
				reset() {
					anchor = null;
					from = target = started = 0;
				}
			};
		}
		//#endregion
		//#region src/client/strip.ts
		function visibleWindow(total, center, size = DEFAULT_SETTINGS.maxVisible) {
			if (total <= 0 || size <= 0) return {
				start: 0,
				end: 0
			};
			const count = Math.min(total, size);
			const start = Math.max(0, Math.min(total - count, center - Math.floor(count / 2)));
			return {
				start,
				end: start + count
			};
		}
		function stackPositions(count, height = railHeight(DEFAULT_SETTINGS), pitch = DEFAULT_SETTINGS.keyGap, markHeight = DEFAULT_SETTINGS.keyHeight) {
			if (count <= 0) return [];
			const top = (height - ((count - 1) * pitch + markHeight)) / 2 + markHeight / 2;
			return Array.from({ length: count }, (_, index) => top + index * pitch);
		}
		let instanceCount = 0;
		const DIRTY_NODES = 1;
		const DIRTY_TURNS = 2;
		const DIRTY_DOM = 4;
		const DIRTY_LAYOUT = 8;
		const DIRTY_VIEW = 32;
		const DIRTY_KEYED_NODES = 64;
		const DIRTY_READER = 128;
		const DIRTY_POINTER = 256;
		const DIRTY_ALL = 63;
		const STREAM_SEMANTIC_MIN_INTERVAL_MS = 120;
		/** Attach to the visible ChatView, never to a background/hidden conversation. */
		function attachKeyStrip(ctx, t, selection, settings = DEFAULT_SETTINGS_SOURCE) {
			if (typeof document === "undefined" || typeof MutationObserver === "undefined" || document.body === null) return () => {};
			let flow;
			let stop;
			let disposed = false;
			let observer;
			const watchLifecycle = () => {
				observer.disconnect();
				if (flow?.isConnected !== true) {
					observer.observe(document.body, {
						childList: true,
						subtree: true,
						attributes: true,
						attributeFilter: ["hidden"]
					});
					return;
				}
				observer.observe(flow, {
					attributes: true,
					attributeFilter: ["hidden"]
				});
				let node = flow.parentElement;
				while (node !== null) {
					observer.observe(node, {
						childList: true,
						attributes: true,
						attributeFilter: ["hidden"]
					});
					if (node === document.body) break;
					node = node.parentElement;
				}
			};
			const reconcile = () => {
				if (disposed) return;
				const enabled = settings.getSnapshot().enabled;
				if (enabled && flow?.isConnected === true && flow.closest("[hidden]") === null) return;
				const next = enabled ? [...document.querySelectorAll("[data-chat-flow]")].find((el) => el.closest("[hidden]") === null) : void 0;
				if (next === flow) {
					watchLifecycle();
					return;
				}
				stop?.();
				stop = void 0;
				flow = next;
				if (next !== void 0) try {
					stop = mount(ctx, next, t, selection, settings);
				} catch {
					console.warn("[dsh-piano-nav] navigator unavailable; native navigation retained");
				}
				watchLifecycle();
			};
			observer = new MutationObserver(reconcile);
			watchLifecycle();
			const unsubscribe = settings.subscribe(reconcile);
			reconcile();
			return () => {
				disposed = true;
				observer.disconnect();
				unsubscribe();
				stop?.();
			};
		}
		function mount(ctx, flow, t, selection, settings) {
			const local = flow.parentElement;
			const scrollport = flow.closest("[data-conversation-scroll]") ?? local;
			const root = scrollport?.parentElement;
			if (local === null || scrollport == null || root == null) return () => {};
			const nativeT = ctx.locale.bind("chat");
			const owner = createNativeNavigation(flow, {
				navigation: () => nativeT("chat.turnNavigation.label"),
				jump: (turn, unloaded) => nativeT(unloaded ? "chat.turnNavigation.jumpLoad" : "chat.turnNavigation.jump", { turn })
			});
			owner.onExternalReconcile = () => {
				schedule(52);
			};
			const landing = createSemanticLanding(flow, owner);
			const prefix = `smcp-${++instanceCount}-`;
			const strip = document.createElement("div");
			strip.className = "smcp-strip smcp-unified";
			strip.tabIndex = 0;
			strip.setAttribute("role", "navigation");
			strip.setAttribute("aria-label", t("nav.aria"));
			strip.hidden = true;
			const tooltip = document.createElement("div");
			tooltip.className = "smcp-tooltip";
			tooltip.id = `${prefix}preview`;
			tooltip.setAttribute("role", "tooltip");
			const badge = document.createElement("span");
			badge.className = "smcp-key-label";
			const title = document.createElement("div");
			title.className = "smcp-tooltip-title";
			const body = document.createElement("div");
			body.className = "smcp-tooltip-body";
			tooltip.append(badge, title, body);
			const status = document.createElement("div");
			status.className = "smcp-navigation-status";
			status.setAttribute("role", "status");
			status.setAttribute("aria-live", "polite");
			strip.append(status);
			const style = document.createElement("style");
			style.textContent = ".smcp-unified[hidden]{display:none!important}.smcp-unified .smcp-bar[aria-busy=\"true\"]{opacity:.4}.smcp-navigation-status{position:absolute;left:0;top:100%;width:220px;font-size:12px;line-height:1.4;padding-top:12px;color:var(--dsw-alias-label-secondary,#73757a)}" + SEMANTIC_CSS;
			const originalPosition = root.style.position;
			const forcedPosition = window.getComputedStyle(root).position === "static";
			if (forcedPosition) root.style.position = "relative";
			root.append(strip, tooltip, style);
			let alive = true;
			let frame = 0;
			let dirty = DIRTY_ALL;
			let binding;
			let sessionLoadingOlder = false;
			let sourceStop;
			let retry;
			let streamRefresh;
			let streamDirtyFlags = 0;
			let lastStreamSemanticAt = Number.NEGATIVE_INFINITY;
			let retries = 0;
			let nodes = [];
			let turns = [];
			let segments = [];
			let questionKeys = /* @__PURE__ */ new Map();
			let nodeByKey = /* @__PURE__ */ new Map();
			let nodeIndexByKey = /* @__PURE__ */ new Map();
			let turnKeys = /* @__PURE__ */ new Map();
			let segmentsByTurn = /* @__PURE__ */ new Map();
			let turnByNumber = /* @__PURE__ */ new Map();
			let turnItemRanges = /* @__PURE__ */ new Map();
			const keyedDirtyKeys = /* @__PURE__ */ new Set();
			let items = [];
			let itemByKey = /* @__PURE__ */ new Map();
			let itemIndexByKey = /* @__PURE__ */ new Map();
			let firstItemByAnchor = /* @__PURE__ */ new Map();
			let active = null;
			let activeSlotKey = null;
			let selected = null;
			let browseStart = null;
			let windowStart = 0;
			let windowSlotStart = 0;
			let pointerInside = false;
			let pendingPointer = null;
			let pointerOffset = null;
			const pointerWave = createPointerWave();
			const motionPreference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
			let requestedTurn = null;
			let failedTurn = null;
			let localFailure = false;
			let activation = 0;
			let nativeReady = false;
			let gateMisses = 0;
			let nativeActiveTurn = null;
			let busyTurn = null;
			let warned = false;
			let top = 0;
			let left = 0;
			let flowLeft = 0;
			let width = 0;
			let height = 0;
			let capacity = 1;
			let stripViewportTop = 0;
			let stripViewportLeft = 0;
			let readingLineY = 0;
			let hitTestXs = [];
			let railSlots = [];
			let visiblePositions = [];
			let visibleSlots = [];
			const expandedKeys = /* @__PURE__ */ new Set();
			const collapsedKeys = /* @__PURE__ */ new Set();
			let projectionDirty = true;
			let projectedActive = null;
			let projectedProtection = "";
			const clearExpansion = () => {
				if (expandedKeys.size === 0) return;
				for (const key of expandedKeys) collapsedKeys.add(key);
				expandedKeys.clear();
				projectionDirty = true;
			};
			let tooltipKey = null;
			let tooltipPosition = null;
			const buttons = /* @__PURE__ */ new Map();
			const perf = {
				renders: 0,
				readerSkips: 0,
				nodeRebuilds: 0,
				keyedSemanticUpdates: 0,
				itemRebuilds: 0,
				turnRebuilds: 0,
				domReconciles: 0,
				mappedAnchorRebuilds: 0,
				railProjections: 0,
				pointerFrames: 0,
				hitTests: 0,
				barWrites: 0
			};
			const debug = {
				mounted: true,
				bars: 0,
				total: 0,
				windowStart: 0,
				sessionId: void 0,
				hiddenReason: null,
				mode: "native-fallback",
				nativeReject: null,
				nativeSkip: null,
				gateMisses: 0,
				layout: {
					left: 0,
					flowLeft: 0,
					width: 0,
					top: 0
				},
				perf,
				questions: () => questionSummary()
			};
			const writeData = (button, name, value) => {
				if (button.dataset[name] === value) return;
				button.dataset[name] = value;
				perf.barWrites++;
			};
			const writeAttr = (button, name, value) => {
				if (button.getAttribute(name) === value) return;
				button.setAttribute(name, value);
				perf.barWrites++;
			};
			const writeStyle = (button, name, value) => {
				if (button.style[name] === value) return;
				button.style[name] = value;
				perf.barWrites++;
			};
			const writeClass = (button, name, enabled) => {
				if (button.classList.contains(name) === enabled) return;
				button.classList.toggle(name, enabled);
				perf.barWrites++;
			};
			const debugHost = globalThis;
			debugHost.__smcpDebug = debug;
			const copy = (kind, turn) => {
				const language = settings.getSnapshot().language;
				if (language === "en") return kind === "turn" ? `Turn ${turn}` : kind === "loading" ? `Loading turn ${turn}…` : `Turn ${turn} was not loaded. Select it to retry.`;
				if (language === "zh-TW") return kind === "turn" ? `第 ${turn} 輪` : kind === "loading" ? `正在載入第 ${turn} 輪…` : `第 ${turn} 輪未載入，點擊重試。`;
				return kind === "turn" ? `第 ${turn} 轮` : kind === "loading" ? `正在加载第 ${turn} 轮…` : `第 ${turn} 轮未加载，点击重试。`;
			};
			const closePreview = () => {
				tooltipKey = null;
				tooltipPosition = null;
				if (tooltip.classList.contains("smcp-tooltip-visible")) tooltip.classList.remove("smcp-tooltip-visible");
				if (strip.hasAttribute("aria-describedby")) strip.removeAttribute("aria-describedby");
			};
			const collapsedCopy = (count) => {
				const language = settings.getSnapshot().language;
				return language === "en" ? `AI · Process output (${count} segments) · Click to expand and jump to first` : language === "zh-TW" ? `AI · 過程輸出（${count} 段）· 點擊展開並定位首條` : `AI · 过程输出（${count} 段）· 点击展开并定位首条`;
			};
			const slotForKey = (key) => {
				const index = key === null ? -1 : itemIndexByKey.get(key) ?? -1;
				return visibleSlots.find((slot) => index >= slot.start && index < slot.end);
			};
			const fallback = (reason) => {
				activation++;
				landing.cancel();
				owner.release();
				strip.hidden = true;
				closePreview();
				pendingPointer = null;
				pointerOffset = null;
				pointerInside = false;
				pointerWave.reset();
				debug.mode = "native-fallback";
				debug.hiddenReason = reason;
				debug.nativeReject = owner.lastReject;
				debug.nativeSkip = owner.lastSkip;
			};
			const flushRender = () => {
				if (!alive) return;
				const pending = dirty;
				dirty = 0;
				try {
					render(pending);
				} catch {
					fallback("contract");
					if (!warned) {
						warned = true;
						console.warn("[dsh-piano-nav] navigator contract changed; native UI restored");
					}
				}
			};
			const schedule = (flags = DIRTY_VIEW) => {
				dirty |= flags;
				if (!alive || frame !== 0) return;
				frame = window.requestAnimationFrame(() => {
					frame = 0;
					flushRender();
				});
			};
			const clearStreamRefresh = (discardDirty = false) => {
				if (streamRefresh !== void 0) window.clearTimeout(streamRefresh);
				streamRefresh = void 0;
				if (discardDirty) {
					keyedDirtyKeys.clear();
					streamDirtyFlags = 0;
				}
			};
			const flushStreamSemantic = () => {
				const pending = streamDirtyFlags;
				streamDirtyFlags = 0;
				lastStreamSemanticAt = window.performance.now();
				if (pending !== 0) schedule(pending);
			};
			const scheduleKeyedSemantic = (keys, flags = 96) => {
				for (const key of keys) keyedDirtyKeys.add(key);
				streamDirtyFlags |= flags;
				const now = window.performance.now();
				const wait = STREAM_SEMANTIC_MIN_INTERVAL_MS - (now - lastStreamSemanticAt);
				if (wait <= 0) {
					clearStreamRefresh();
					flushStreamSemantic();
					return;
				}
				if (streamRefresh !== void 0) return;
				streamRefresh = window.setTimeout(() => {
					streamRefresh = void 0;
					if (!alive) return;
					flushStreamSemantic();
				}, wait);
			};
			const readingKey = () => {
				perf.hitTests++;
				const hitTest = document.elementsFromPoint?.bind(document);
				if (typeof hitTest === "function") for (const x of hitTestXs) for (const element of hitTest(x, readingLineY)) {
					const row = element.closest("[data-chat-anchor-key]");
					if (row === null || !flow.contains(row) || row.closest("[hidden]") !== null) continue;
					const anchor = row.dataset.chatAnchorKey;
					if (anchor === void 0) continue;
					const key = firstItemByAnchor.get(anchor);
					if (key !== void 0) return key;
				}
				const preceding = owner.anchorAtOrBefore(readingLineY);
				if (preceding !== null) {
					const key = firstItemByAnchor.get(preceding);
					if (key !== void 0) return key;
				}
				return nativeActiveTurn === null ? null : itemByKey.has(`turn:${nativeActiveTurn}`) ? `turn:${nativeActiveTurn}` : null;
			};
			const availableSegment = (segment) => {
				const visible = owner.rowFor(segment.anchorKey) !== null;
				if (!visible && !((segment.kind === "question" || segment.kind === "answer" || segment.kind === "output" || segment.kind === "final") && landing.canReveal(segment.anchorKey))) return [];
				return [segment.kind === "output" ? {
					...segment,
					folded: !visible
				} : segment];
			};
			const questionSummary = () => {
				const snapshot = binding === void 0 ? void 0 : ctx.uiConversation.binding(binding).target("chat").getSnapshot();
				const order = new Set(snapshot?.order ?? []);
				const materialized = snapshot?.nodes.values() ?? [];
				const projection = createQuestionDiagnostics();
				buildQuestionKeys(nodes, turnOf, projection);
				const interactive = (item) => item.kind === "question" || item.kind === "answer";
				const generated = segments.filter(interactive);
				const available = generated.flatMap(availableSegment);
				return {
					source: {
						orderedNodes: order.size,
						observedNodes: nodes.length,
						materializedNodes: materialized.length,
						missingOrderedNodes: [...order].filter((key) => snapshot?.nodes.get(key) === void 0).length,
						toolNodesOutsideOrder: materialized.filter((node) => node.kind === "tool-call" && !order.has(node.key)).length
					},
					projection,
					display: {
						generated: generated.length,
						unavailableAnchors: generated.length - available.length,
						unassembled: available.filter((segment) => segment.turn === null || turnByNumber.get(segment.turn)?.anchor.kind !== "loaded").length,
						assembled: items.filter(interactive).length,
						visible: visibleSlots.filter((slot) => interactive(slot.item)).length
					}
				};
			};
			const projectSlots = () => {
				const protection = `${busyTurn}:${requestedTurn}:${failedTurn}`;
				if (projectionDirty || projectedActive !== active || projectedProtection !== protection) {
					railSlots = projectRailSlots(items, itemIndexByKey.get(active ?? "") ?? -1, expandedKeys, new Set([
						busyTurn,
						requestedTurn,
						failedTurn
					].filter((turn) => turn !== null)), collapsedKeys);
					projectionDirty = false;
					projectedActive = active;
					projectedProtection = protection;
					perf.railProjections++;
				}
				return railSlots;
			};
			const rebuildItemIndex = () => {
				projectionDirty = true;
				itemByKey = /* @__PURE__ */ new Map();
				itemIndexByKey = /* @__PURE__ */ new Map();
				firstItemByAnchor = /* @__PURE__ */ new Map();
				turnItemRanges = /* @__PURE__ */ new Map();
				items.forEach((item, index) => {
					itemByKey.set(item.key, item);
					itemIndexByKey.set(item.key, index);
					if (item.anchorKey !== null && !firstItemByAnchor.has(item.anchorKey)) firstItemByAnchor.set(item.anchorKey, item.key);
					const range = turnItemRanges.get(item.turn);
					if (range === void 0) turnItemRanges.set(item.turn, {
						start: index,
						count: 1
					});
					else range.count++;
				});
				owner.setMappedAnchors(firstItemByAnchor.keys());
				for (const key of collapsedKeys) if (!itemByKey.has(key)) collapsedKeys.delete(key);
				perf.mappedAnchorRebuilds++;
			};
			const rebuildSemanticState = () => {
				keyedDirtyKeys.clear();
				questionKeys = buildQuestionKeys(nodes, turnOf);
				segments = buildNavigationNodesWithQuestions(nodes, questionKeys);
				nodeByKey = /* @__PURE__ */ new Map();
				nodeIndexByKey = /* @__PURE__ */ new Map();
				turnKeys = /* @__PURE__ */ new Map();
				nodes.forEach((node, index) => {
					nodeByKey.set(node.key, node);
					nodeIndexByKey.set(node.key, index);
					const turn = turnOf(node);
					if (turn === null) return;
					const keys = turnKeys.get(turn) ?? [];
					keys.push(node.key);
					turnKeys.set(turn, keys);
				});
				segmentsByTurn = /* @__PURE__ */ new Map();
				for (const segment of segments) {
					if (segment.turn === null) continue;
					const list = segmentsByTurn.get(segment.turn) ?? [];
					list.push(segment);
					segmentsByTurn.set(segment.turn, list);
				}
				perf.nodeRebuilds++;
			};
			const rebuildItemsFromSegments = () => {
				segments = [...segmentsByTurn.values()].flat();
				const availableSegments = segments.flatMap(availableSegment);
				items = buildPianoItems(turns, availableSegments, (turn) => copy("turn", turn));
				rebuildItemIndex();
				perf.itemRebuilds++;
				debug.total = items.length;
			};
			const replaceTurnItems = (turn, nextItems) => {
				const range = turnItemRanges.get(turn);
				if (range === void 0 || range.count !== nextItems.length) return false;
				const previous = items.slice(range.start, range.start + range.count);
				if (previous.some((item, index) => item.key !== nextItems[index]?.key)) return false;
				projectionDirty = true;
				const anchorsStable = previous.every((item, index) => item.anchorKey === nextItems[index]?.anchorKey);
				if (!anchorsStable) {
					const oldKeys = new Set(previous.map((item) => item.key));
					for (const item of previous) if (item.anchorKey !== null && oldKeys.has(firstItemByAnchor.get(item.anchorKey) ?? "")) firstItemByAnchor.delete(item.anchorKey);
				}
				nextItems.forEach((item, offset) => {
					const index = range.start + offset;
					items[index] = item;
					itemByKey.set(item.key, item);
					itemIndexByKey.set(item.key, index);
					if (!anchorsStable && item.anchorKey !== null && !firstItemByAnchor.has(item.anchorKey)) firstItemByAnchor.set(item.anchorKey, item.key);
				});
				if (!anchorsStable) {
					owner.setMappedAnchors(firstItemByAnchor.keys());
					perf.mappedAnchorRebuilds++;
				}
				return true;
			};
			const refreshKeyedSemantic = () => {
				const dirtyKeys = [...keyedDirtyKeys];
				keyedDirtyKeys.clear();
				if (dirtyKeys.length === 0) return;
				const dirtyTurns = /* @__PURE__ */ new Set();
				let requiresFullSemantic = false;
				for (const key of dirtyKeys) {
					const index = nodeIndexByKey.get(key);
					const previous = nodeByKey.get(key);
					const next = index === void 0 ? void 0 : nodes[index];
					if (previous === void 0 || next === void 0 || next.key !== key || previous.kind !== next.kind || previous.kind === "tool-call" || next.kind === "tool-call") {
						requiresFullSemantic = true;
						break;
					}
					const oldTurn = turnOf(previous);
					const nextTurn = turnOf(next);
					if (oldTurn !== nextTurn || nextTurn === null) {
						requiresFullSemantic = true;
						break;
					}
					nodeByKey.set(key, next);
					dirtyTurns.add(nextTurn);
				}
				if (requiresFullSemantic) {
					rebuildSemanticState();
					rebuildItemsFromSegments();
					return;
				}
				let rebuildAllItems = false;
				for (const turn of dirtyTurns) {
					const keys = turnKeys.get(turn);
					const navigationTurn = turnByNumber.get(turn);
					if (keys === void 0 || navigationTurn === void 0) {
						rebuildAllItems = true;
						continue;
					}
					const nextSegments = buildNavigationNodesWithQuestions(keys.flatMap((key) => {
						const node = nodeByKey.get(key);
						return node === void 0 ? [] : [node];
					}), questionKeys);
					segmentsByTurn.set(turn, nextSegments);
					const nextItems = buildPianoItemsForTurn(navigationTurn, nextSegments.flatMap(availableSegment), (value) => copy("turn", value));
					if (!replaceTurnItems(turn, nextItems)) rebuildAllItems = true;
					perf.keyedSemanticUpdates++;
				}
				if (rebuildAllItems) rebuildItemsFromSegments();
				else debug.total = items.length;
			};
			const measureLayout = () => {
				const rootRect = root.getBoundingClientRect();
				const flowRect = flow.getBoundingClientRect();
				const scrollRect = scrollport.getBoundingClientRect();
				flowLeft = flowRect.left - rootRect.left;
				width = root.clientWidth || rootRect.width;
				left = Math.max(16, flowLeft - 108);
				const config = settings.getSnapshot();
				const available = Math.max(0, scrollport.clientHeight - (composerSeat?.offsetHeight ?? 0));
				height = Math.min(railHeight(config), Math.max(config.keyHeight, available - 48));
				capacity = Math.min(config.maxVisible, Math.max(1, Math.floor((height - config.keyHeight) / config.keyGap) + 1));
				top = Math.max(8, scrollRect.top - rootRect.top + (available - height) / 2);
				stripViewportTop = rootRect.top + top;
				stripViewportLeft = rootRect.left + left;
				readingLineY = scrollRect.top + Math.min(120, scrollport.clientHeight * .18);
				hitTestXs = flowRect.width > 0 ? [flowRect.left + flowRect.width / 2, Math.min(flowRect.right - 1, flowRect.left + 18)] : [];
				debug.layout.left = left;
				debug.layout.flowLeft = flowLeft;
				debug.layout.width = width;
				debug.layout.top = top;
			};
			const renderFeedback = (pending) => {
				const config = settings.getSnapshot();
				const focusedSlot = slotForKey(selected);
				const focusIndex = focusedSlot?.displayIndex ?? -1;
				const focused = selected === null || focusedSlot === void 0 ? void 0 : itemByKey.get(selected);
				if (focused !== void 0 && focusedSlot !== void 0) {
					const collapsed = focusedSlot.end - focusedSlot.start > 1;
					const previewIdentity = `${focused.key}:${collapsed ? focusedSlot.end - focusedSlot.start : 1}:${config.language}`;
					const contentChanged = tooltipKey !== previewIdentity || (pending & 67) !== 0;
					if (contentChanged) {
						tooltipKey = previewIdentity;
						badge.textContent = collapsed ? collapsedCopy(focusedSlot.end - focusedSlot.start) : semanticLabel(focused, config.language);
						title.textContent = collapsed ? copy("turn", focused.turn) : focused.title;
						body.textContent = collapsed ? "" : focused.preview;
					}
					const nextTooltipPosition = `${left}:${width}:${top}:${visiblePositions[focusIndex]}`;
					if (contentChanged || (pending & DIRTY_LAYOUT) !== 0 || tooltipPosition !== nextTooltipPosition) {
						tooltipPosition = nextTooltipPosition;
						const previewWidth = tooltip.offsetWidth || 400;
						const previewHeight = tooltip.offsetHeight || 150;
						const rootHeight = root.clientHeight;
						tooltip.style.left = `${Math.max(8, Math.min(left + 64, width - previewWidth - 8))}px`;
						tooltip.style.top = `${Math.max(8, Math.min(top + visiblePositions[focusIndex] - 48, rootHeight - previewHeight - 8))}px`;
					}
					if (!tooltip.classList.contains("smcp-tooltip-visible")) tooltip.classList.add("smcp-tooltip-visible");
					const focusedId = buttons.get(focusedSlot.item.key).id;
					if (strip.getAttribute("aria-activedescendant") !== focusedId) strip.setAttribute("aria-activedescendant", focusedId);
					if (strip.getAttribute("aria-describedby") !== tooltip.id) strip.setAttribute("aria-describedby", tooltip.id);
				} else {
					closePreview();
					if (strip.hasAttribute("aria-activedescendant")) strip.removeAttribute("aria-activedescendant");
				}
				const wave = pointerWave.sample(window.performance.now(), motionPreference?.matches);
				const waveSlot = slotForKey(wave.anchor?.key ?? null);
				if (wave.anchor !== null && waveSlot === void 0) pointerWave.reset();
				const followingPointer = focusIndex >= 0 && pointerOffset !== null;
				if (strip.classList.contains("smcp-pointer-follow") !== followingPointer) strip.classList.toggle("smcp-pointer-follow", followingPointer);
				strip.classList.toggle("smcp-pointer-frame", pending === DIRTY_POINTER || wave.moving);
				const waveCenter = followingPointer ? focusIndex + pointerOffset : focusedSlot !== void 0 ? focusIndex : waveSlot === void 0 ? null : waveSlot.displayIndex + (wave.anchor?.offset ?? 0);
				const strength = followingPointer || focusedSlot === void 0 ? wave.strength : 1;
				visibleSlots.forEach((slot) => {
					const button = buttons.get(slot.item.key);
					if (button === void 0) return;
					writeClass(button, "smcp-bar-hover", slot === focusedSlot);
					writeStyle(button, "width", `${barWidth(slot.item, slot.displayIndex, waveCenter, strength)}px`);
				});
				if (wave.moving && waveSlot !== void 0) schedule(DIRTY_POINTER);
			};
			const render = (pending) => {
				perf.renders++;
				if (pending === DIRTY_POINTER) {
					if (!nativeReady || strip.hidden) {
						pendingPointer = null;
						return;
					}
					applyPointer();
					renderFeedback(pending);
					perf.pointerFrames++;
					return;
				}
				if ((pending & DIRTY_TURNS) !== 0) {
					const loaded = (binding === void 0 ? void 0 : ctx.uiConversation.binding(binding).target("chat").getSnapshot())?.navigation.items() ?? [];
					const outline = binding?.session.projections.faceOf("turnOutline").getSnapshot();
					turns = mergeNavigationTurns(loaded, outline);
					turnByNumber = new Map(turns.map((turn) => [turn.turn, turn]));
					perf.turnRebuilds++;
				}
				if ((pending & DIRTY_NODES) !== 0) rebuildSemanticState();
				else if ((pending & DIRTY_KEYED_NODES) !== 0) refreshKeyedSemantic();
				if ((pending & 6) !== 0) {
					nativeReady = owner.reconcile(turns);
					if ((pending & DIRTY_DOM) !== 0) landing.refresh();
					perf.domReconciles++;
				}
				if ((pending & 7) !== 0) rebuildItemsFromSegments();
				if ((pending & 22) !== 0) {
					busyTurn = owner.busy();
					nativeActiveTurn = owner.active();
				}
				if ((pending & DIRTY_LAYOUT) !== 0 || width === 0) measureLayout();
				const gateFails = () => !nativeReady || items.length === 0 || width < 520 || left + 70 > flowLeft;
				if (gateFails()) {
					let recovered = false;
					if (debug.mode === "piano" && nativeReady && items.length !== 0) {
						measureLayout();
						if (!gateFails()) recovered = true;
						else if (++gateMisses < 3) {
							debug.gateMisses = gateMisses;
							schedule(DIRTY_LAYOUT);
							return;
						}
					}
					if (!recovered) {
						gateMisses = 0;
						debug.gateMisses = 0;
						fallback(!nativeReady ? "contract" : items.length === 0 ? "empty" : width < 520 ? "narrow" : "overlap");
						return;
					}
				}
				gateMisses = 0;
				debug.gateMisses = 0;
				const readerOnly = (pending & DIRTY_READER) !== 0 && (pending & -129) === 0;
				if (readerOnly) {
					const nextActive = readingKey() ?? `turn:${nativeActiveTurn ?? turns.at(-1)?.turn}`;
					if (nextActive === active) {
						perf.readerSkips++;
						return;
					}
					active = nextActive;
				}
				const config = settings.getSnapshot();
				if (requestedTurn !== null && busyTurn === null && !sessionLoadingOlder) {
					failedTurn = turns.find((turn) => turn.turn === requestedTurn)?.anchor.kind === "unloaded" ? requestedTurn : null;
					requestedTurn = null;
				}
				if (!readerOnly) active = readingKey() ?? `turn:${nativeActiveTurn ?? turns.at(-1)?.turn}`;
				if (selected !== null && !itemByKey.has(selected)) selected = null;
				const centerKey = selected !== null && (document.activeElement === strip || pointerInside || busyTurn !== null) ? selected : active;
				const center = Math.max(0, centerKey === null ? 0 : itemIndexByKey.get(centerKey) ?? 0);
				for (const key of expandedKeys) if (!itemByKey.has(key)) {
					expandedKeys.delete(key);
					projectionDirty = true;
				}
				railSlots = projectSlots();
				const manual = railSlotIndex(railSlots, browseStart === null ? -1 : itemIndexByKey.get(browseStart) ?? -1);
				windowSlotStart = manual < 0 ? visibleWindow(railSlots.length, railSlotIndex(railSlots, center), capacity).start : Math.max(0, Math.min(railSlots.length - capacity, manual));
				visibleSlots = railSlots.slice(windowSlotStart, windowSlotStart + capacity).map((slot, displayIndex) => ({
					...slot,
					displayIndex
				}));
				activeSlotKey = slotForKey(active)?.item.key ?? null;
				windowStart = visibleSlots[0]?.start ?? 0;
				const stripTop = `${top}px`;
				const stripLeft = `${left}px`;
				const stripHeight = `${height}px`;
				if (strip.style.top !== stripTop) strip.style.top = stripTop;
				if (strip.style.transform !== "none") strip.style.transform = "none";
				if (strip.style.left !== stripLeft) strip.style.left = stripLeft;
				if (strip.style.height !== stripHeight) strip.style.height = stripHeight;
				visiblePositions = stackPositions(visibleSlots.length, height, config.keyGap, config.keyHeight);
				const retained = new Set(visibleSlots.map((slot) => slot.item.key));
				for (const [key, button] of buttons) if (!retained.has(key)) {
					button.remove();
					buttons.delete(key);
				}
				applyPointer();
				visibleSlots.forEach((slot) => {
					const { item, displayIndex: index } = slot;
					const collapsed = slot.end - slot.start > 1;
					let button = buttons.get(item.key);
					if (button === void 0) {
						button = document.createElement("button");
						button.type = "button";
						button.tabIndex = -1;
						button.className = "smcp-bar";
						button.dataset.key = item.key;
						button.id = prefix + encodeURIComponent(item.key);
						buttons.set(item.key, button);
						strip.append(button);
					}
					writeData(button, "turn", String(item.turn));
					writeData(button, "role", item.role);
					writeData(button, "kind", collapsed ? "output" : item.kind ?? "turn");
					writeData(button, "collapsed", String(collapsed));
					writeData(button, "count", String(slot.end - slot.start));
					writeData(button, "unloaded", String(!collapsed && item.anchorKey === null));
					const navBlocked = !collapsed && item.anchorKey === null && !owner.hasButton(item.turn);
					if (navBlocked !== button.hasAttribute("disabled")) {
						if (navBlocked) button.setAttribute("disabled", "");
						else button.removeAttribute("disabled");
						perf.barWrites++;
					}
					writeAttr(button, "aria-label", collapsed ? collapsedCopy(slot.end - slot.start) : `${copy("turn", item.turn)} · ${semanticLabel(item, config.language)}: ${item.title}`);
					if (collapsed) writeAttr(button, "aria-expanded", "false");
					else if (button.hasAttribute("aria-expanded")) {
						button.removeAttribute("aria-expanded");
						perf.barWrites++;
					}
					writeAttr(button, "aria-current", String(item.key === activeSlotKey));
					writeAttr(button, "aria-busy", String(item.turn === busyTurn));
					writeClass(button, "smcp-bar-current", item.key === activeSlotKey);
					writeStyle(button, "top", `${visiblePositions[index] - config.keyHeight / 2}px`);
					writeStyle(button, "height", `${config.keyHeight}px`);
				});
				renderFeedback(pending);
				status.textContent = localFailure ? landingFailure(config.language) : busyTurn !== null ? copy("loading", busyTurn) : failedTurn !== null ? copy("failed", failedTurn) : "";
				strip.hidden = false;
				owner.claim();
				debug.mode = "piano";
				debug.hiddenReason = null;
				debug.nativeReject = null;
				debug.nativeSkip = owner.lastSkip;
				debug.bars = visibleSlots.length;
				debug.windowStart = windowStart;
			};
			const bind = () => {
				const id = selection.getSnapshot();
				const next = id === void 0 ? void 0 : ctx.sessions.binding(id);
				if (next === binding && sourceStop !== void 0) return;
				sourceStop?.();
				sourceStop = void 0;
				clearStreamRefresh(true);
				owner.cancel();
				fallback("binding");
				binding = next;
				nodes = [];
				selected = active = browseStart = null;
				clearExpansion();
				collapsedKeys.clear();
				projectionDirty = true;
				sessionLoadingOlder = next?.session.getSnapshot().loadingOlder ?? false;
				requestedTurn = failedTurn = null;
				localFailure = false;
				debug.sessionId = id === void 0 ? void 0 : String(id);
				if (retry !== void 0) clearTimeout(retry);
				retry = void 0;
				if (next === void 0) {
					turns = [];
					segments = [];
					items = [];
					questionKeys = /* @__PURE__ */ new Map();
					nodeByKey.clear();
					nodeIndexByKey.clear();
					turnKeys.clear();
					segmentsByTurn.clear();
					turnByNumber.clear();
					turnItemRanges.clear();
					itemByKey.clear();
					itemIndexByKey.clear();
					firstItemByAnchor.clear();
					for (const button of buttons.values()) button.remove();
					buttons.clear();
					if (id !== void 0 && retries++ < 20) retry = setTimeout(() => {
						retry = void 0;
						bind();
					}, 300);
					schedule(DIRTY_ALL);
					return;
				}
				retries = 0;
				const target = ctx.uiConversation.binding(next).target("chat");
				const stops = [];
				try {
					stops.push(observeChatNodes(target, (value, change, dirtyKeys) => {
						if (!alive || binding !== next) return;
						nodes = value;
						if (change === "navigation") {
							scheduleKeyedSemantic([], 50);
							return;
						}
						if (change === "keyed") {
							scheduleKeyedSemantic(dirtyKeys ?? []);
							return;
						}
						clearStreamRefresh(true);
						lastStreamSemanticAt = window.performance.now();
						schedule(63);
					}));
					stops.push(next.session.projections.faceOf("turnOutline").subscribe(() => schedule(50)));
					sessionLoadingOlder = next.session.getSnapshot().loadingOlder ?? false;
					stops.push(next.session.subscribe(() => {
						const nextLoadingOlder = next.session.getSnapshot().loadingOlder ?? false;
						if (nextLoadingOlder === sessionLoadingOlder) return;
						sessionLoadingOlder = nextLoadingOlder;
						schedule(48);
					}));
					sourceStop = () => {
						for (const dispose of stops) dispose();
					};
				} catch (error) {
					for (const dispose of stops.reverse()) dispose();
					throw error;
				}
				schedule(DIRTY_ALL);
			};
			const activate = (item) => {
				if (item === void 0 || !nativeReady || strip.hidden) return;
				if (!expandedKeys.has(item.key)) clearExpansion();
				if (item.anchorKey === null && !owner.hasButton(item.turn)) {
					schedule(DIRTY_VIEW);
					return;
				}
				const ticket = ++activation;
				failedTurn = null;
				localFailure = false;
				requestedTurn = item.anchorKey === null ? item.turn : null;
				selected = item.key;
				active = item.key;
				browseStart = null;
				strip.focus({ preventScroll: true });
				landing.navigate(item).then((ok) => {
					if (!alive || ticket !== activation || ok === void 0) return;
					if (!ok) {
						requestedTurn = null;
						localFailure = true;
					}
					schedule();
				});
				schedule();
			};
			const BAR_HIT_TOLERANCE = 3;
			const baseWidth = (item) => item.key === activeSlotKey ? 24 : 10;
			const barWidth = (item, index, focusIndex, strength = 1) => {
				const base = baseWidth(item);
				const wave = focusIndex === null ? 0 : Math.exp(-((index - focusIndex) ** 2) / (2 * 1.35 ** 2));
				return Math.max(10, base + (48 - base) * wave * strength);
			};
			const nearestIndex = (clientY) => {
				if (visibleSlots.length === 0) return -1;
				let best = 0;
				const y = clientY - stripViewportTop;
				for (let i = 1; i < visibleSlots.length; i++) if (Math.abs(visiblePositions[i] - y) < Math.abs(visiblePositions[best] - y)) best = i;
				return best;
			};
			const keyHitAt = (clientX, clientY) => {
				const index = nearestIndex(clientY);
				if (index < 0) return null;
				const slot = visibleSlots[index];
				if (slot === void 0) return null;
				if (Math.abs(clientY - stripViewportTop - visiblePositions[index]) > settings.getSnapshot().keyGap / 2) return null;
				const item = slot.item;
				const button = buttons.get(item.key);
				const painted = button === void 0 ? baseWidth(item) : button.getBoundingClientRect().width;
				const x = clientX - stripViewportLeft;
				return x >= -3 && x <= painted + BAR_HIT_TOLERANCE ? {
					index,
					painted
				} : null;
			};
			const applyPointer = () => {
				const sample = pendingPointer;
				pendingPointer = null;
				if (sample === null) return;
				const hit = keyHitAt(sample.x, sample.y);
				const slot = hit === null ? void 0 : visibleSlots[hit.index];
				pointerInside = true;
				browseStart ??= items[windowStart]?.key ?? null;
				selected = slot?.item.key ?? null;
				pointerOffset = hit === null ? null : (sample.y - stripViewportTop - visiblePositions[hit.index]) / settings.getSnapshot().keyGap;
				const peak = slot === void 0 ? 0 : barWidth(slot.item, slot.displayIndex, slot.displayIndex + pointerOffset) - baseWidth(slot.item);
				const paintedStrength = hit === null || slot === void 0 || peak === 0 ? 0 : (hit.painted - baseWidth(slot.item)) / peak;
				const now = window.performance.now(), reducedMotion = motionPreference?.matches;
				pointerWave.point(slot === void 0 ? null : {
					key: slot.item.key,
					offset: pointerOffset
				}, now, reducedMotion, paintedStrength);
				if (slot !== void 0) {
					const nextWidth = barWidth(slot.item, slot.displayIndex, slot.displayIndex + pointerOffset, pointerWave.sample(now, reducedMotion).strength);
					if (sample.x - stripViewportLeft > nextWidth + BAR_HIT_TOLERANCE) {
						selected = null;
						pointerOffset = null;
						pointerWave.point(null, now, reducedMotion);
					}
				}
			};
			const clearPointer = () => {
				pendingPointer = null;
				pointerOffset = null;
				pointerWave.reset();
			};
			const pointerMove = (event) => {
				pendingPointer = {
					x: event.clientX,
					y: event.clientY
				};
				schedule(DIRTY_POINTER);
			};
			const retireExpansion = () => {
				clearExpansion();
				selected = null;
				browseStart = null;
				schedule(DIRTY_VIEW);
			};
			const releaseHover = () => {
				selected = null;
				if (expandedKeys.size === 0) browseStart = null;
				schedule(DIRTY_VIEW);
			};
			const clearHover = () => {
				clearPointer();
				releaseHover();
			};
			const pointerLeave = () => {
				pendingPointer = null;
				pointerOffset = null;
				pointerInside = false;
				pointerWave.point(null, window.performance.now(), motionPreference?.matches);
				releaseHover();
			};
			const engage = (key) => {
				if (frame !== 0) {
					window.cancelAnimationFrame(frame);
					frame = 0;
					flushRender();
				}
				if (!nativeReady || strip.hidden) return;
				const slot = slotForKey(key);
				if (slot === void 0) return;
				clearPointer();
				if (slot.end - slot.start > 1) {
					clearExpansion();
					for (let index = slot.start; index < slot.end; index++) {
						const member = items[index].key;
						collapsedKeys.delete(member);
						expandedKeys.add(member);
					}
					projectionDirty = true;
					activate(items[slot.start]);
					const nextSlots = projectSlots();
					const runStart = railSlotIndex(nextSlots, slot.start);
					const count = Math.min(capacity, slot.end - slot.start);
					browseStart = nextSlots[Math.max(0, Math.min(nextSlots.length - capacity, runStart - Math.floor((capacity - count) / 2)))]?.item.key ?? null;
					schedule(DIRTY_VIEW);
					return;
				}
				activate(itemByKey.get(key ?? ""));
			};
			const click = (event) => {
				if (frame !== 0) {
					window.cancelAnimationFrame(frame);
					frame = 0;
					flushRender();
				}
				const key = event.target.closest("[data-key]")?.dataset.key;
				if (key !== void 0) {
					engage(key);
					return;
				}
				const hit = keyHitAt(event.clientX, event.clientY);
				if (hit !== null) engage(visibleSlots[hit.index].item.key);
			};
			const wheel = (event) => {
				if (event.deltaY === 0 || items.length === 0) return;
				event.preventDefault();
				clearPointer();
				const first = items[windowStart]?.key;
				const nextSlots = projectSlots();
				const current = railSlotIndex(nextSlots, itemIndexByKey.get(first ?? "") ?? -1);
				browseStart = nextSlots[Math.max(0, Math.min(nextSlots.length - capacity, current + Math.sign(event.deltaY) * 3))]?.item.key ?? null;
				selected = null;
				schedule(DIRTY_VIEW);
			};
			const cancelLocal = () => {
				activation++;
				landing.cancel();
				requestedTurn = failedTurn = null;
				localFailure = false;
				schedule(48);
			};
			const cancel = () => {
				cancelLocal();
				owner.cancel();
			};
			const keydown = (event) => {
				if (event.key === "Escape") {
					clearPointer();
					event.preventDefault();
					cancel();
					retireExpansion();
					return;
				}
				if (event.key === "Enter" || event.key === " ") {
					clearPointer();
					event.preventDefault();
					engage(selected ?? active ?? items[windowStart]?.key ?? null);
					return;
				}
				if (![
					"ArrowUp",
					"ArrowDown",
					"Home",
					"End",
					"PageUp",
					"PageDown"
				].includes(event.key)) return;
				event.preventDefault();
				clearPointer();
				const index = Math.max(0, itemIndexByKey.get(selected ?? active ?? "") ?? 0);
				const page = Math.max(1, visibleSlots.length);
				const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : event.key === "PageUp" ? -page : page)));
				selected = items[next]?.key ?? null;
				const slot = railSlotIndex(railSlots, next);
				browseStart = railSlots[visibleWindow(railSlots.length, slot, page).start]?.item.key ?? null;
				schedule(DIRTY_VIEW);
			};
			const readerKey = (event) => {
				if (event.target.closest("input,textarea,select,[contenteditable=\"true\"]") !== null) return;
				if ([
					"ArrowUp",
					"ArrowDown",
					"Home",
					"End",
					"PageUp",
					"PageDown",
					" "
				].includes(event.key)) cancel();
			};
			const readerPointer = (event) => {
				if (event.target.closest("input,textarea,select,[contenteditable=\"true\"]") === null) cancelLocal();
			};
			const onScroll = () => {
				schedule(DIRTY_READER);
			};
			let composerSeat = scrollport.querySelector("[data-composer-seat]");
			let resize = null;
			const touchesAnchor = (node) => node instanceof window.Element && (node.matches("[data-chat-anchor-key]") || node.querySelector("[data-chat-anchor-key]") !== null);
			const touchesNavigation = (node) => node instanceof window.Element && (node.matches("nav,[role=\"navigation\"]") || node.querySelector("nav,[role=\"navigation\"]") !== null);
			const touchesComposer = (node) => node instanceof window.Element && (node.matches("[data-composer-seat]") || node.querySelector("[data-composer-seat]") !== null);
			let composerParent = composerSeat?.parentElement ?? null;
			let composerDom = null;
			const observeComposerParent = () => {
				composerDom?.disconnect();
				if (composerDom === null) return;
				composerDom.observe(scrollport, { childList: true });
				if (composerParent !== null && composerParent !== scrollport) composerDom.observe(composerParent, { childList: true });
			};
			const syncComposerSeat = () => {
				const next = scrollport.querySelector("[data-composer-seat]");
				const nextParent = next?.parentElement ?? null;
				if (next === composerSeat && nextParent === composerParent) return;
				if (composerSeat !== null) resize?.unobserve(composerSeat);
				composerSeat = next;
				composerParent = nextParent;
				if (composerSeat !== null) resize?.observe(composerSeat);
				observeComposerParent();
			};
			const childListChangesNavigation = (record) => {
				const target = record.target instanceof window.Element ? record.target : record.target.parentElement;
				const outsideFlow = target === null || !flow.contains(target);
				if (outsideFlow && target?.closest("nav,[role=\"navigation\"]") !== null) return true;
				if (outsideFlow) {
					for (const node of record.addedNodes) if (touchesNavigation(node)) return true;
					for (const node of record.removedNodes) if (touchesNavigation(node)) return true;
				}
				for (const node of record.addedNodes) if (touchesAnchor(node)) return true;
				for (const node of record.removedNodes) if (touchesAnchor(node)) return true;
				return false;
			};
			let nativeSurface = null;
			let nativeSurfaceParent = null;
			const nativeScope = scrollport ?? local;
			const nativeStructureDom = new MutationObserver(() => {
				syncNativeSurfaceObserver();
				schedule(36);
			});
			const syncNativeSurfaceObserver = () => {
				const next = [...nativeScope.querySelectorAll("nav,[role=\"navigation\"]")].find((element) => !flow.contains(element) && element.getAttribute("aria-label") === nativeT("chat.turnNavigation.label")) ?? null;
				const nextParent = next?.parentElement ?? (nativeSurfaceParent !== null && nativeScope.contains(nativeSurfaceParent) ? nativeSurfaceParent : null);
				if (next === nativeSurface && nextParent === nativeSurfaceParent) return;
				nativeStructureDom.disconnect();
				nativeSurface = next;
				nativeSurfaceParent = nextParent;
				if (nativeSurface !== null) nativeStructureDom.observe(nativeSurface, {
					childList: true,
					subtree: true
				});
				if (nextParent !== null && nextParent !== nativeScope) nativeStructureDom.observe(nextParent, { childList: true });
			};
			const structureDom = new MutationObserver((records) => {
				if (!records.some(childListChangesNavigation)) return;
				syncNativeSurfaceObserver();
				schedule(36);
			});
			structureDom.observe(flow, { childList: true });
			structureDom.observe(nativeScope, { childList: true });
			structureDom.observe(local, { childList: true });
			syncNativeSurfaceObserver();
			const attributeDom = new MutationObserver((records) => {
				let flags = 0;
				for (const record of records) {
					const target = record.target instanceof window.Element ? record.target : null;
					if (record.attributeName === "hidden") {
						if (target === null || !flow.contains(target) || target.matches("[data-chat-anchor-key]")) flags |= 36;
						continue;
					}
					if (target !== null && flow.contains(target)) continue;
					if (record.attributeName === "aria-label" || record.attributeName === "disabled") flags |= 36;
					else if (record.attributeName === "aria-current" || record.attributeName === "aria-busy") flags |= 48;
				}
				if (flags !== 0) schedule(flags);
			});
			attributeDom.observe(nativeScope, {
				subtree: true,
				attributes: true,
				attributeFilter: [
					"hidden",
					"aria-label",
					"aria-current",
					"aria-busy",
					"disabled"
				]
			});
			composerDom = new MutationObserver((records) => {
				if (!records.some((record) => [...record.addedNodes, ...record.removedNodes].some(touchesComposer))) return;
				syncComposerSeat();
				schedule(40);
			});
			observeComposerParent();
			resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => schedule(40));
			resize?.observe(root);
			resize?.observe(flow);
			resize?.observe(scrollport);
			if (composerSeat !== null) resize?.observe(composerSeat);
			strip.addEventListener("pointermove", pointerMove);
			strip.addEventListener("pointerleave", pointerLeave);
			strip.addEventListener("blur", clearHover);
			const motionChanged = () => {
				schedule(DIRTY_POINTER);
			};
			motionPreference?.addEventListener?.("change", motionChanged);
			strip.addEventListener("click", click);
			strip.addEventListener("wheel", wheel, { passive: false });
			strip.addEventListener("keydown", keydown);
			scrollport.addEventListener("scroll", onScroll, { passive: true });
			scrollport.addEventListener("wheel", cancel, { passive: true });
			scrollport.addEventListener("touchstart", readerPointer, { passive: true });
			scrollport.addEventListener("pointerdown", readerPointer, { passive: true });
			scrollport.addEventListener("keydown", readerKey);
			const listStop = ctx.sessions.list.subscribe(() => {
				retries = 0;
				bind();
			});
			const selectedStop = selection.subscribe(() => {
				retries = 0;
				bind();
			});
			let appliedSettings = settings.getSnapshot();
			syncPalette(strip.style, appliedSettings);
			const settingsStop = settings.subscribe(() => {
				const next = settings.getSnapshot();
				syncPalette(strip.style, next, appliedSettings);
				let flags = 0;
				if (next.language !== appliedSettings.language) flags |= 43;
				if (next.keyHeight !== appliedSettings.keyHeight || next.keyGap !== appliedSettings.keyGap || next.maxVisible !== appliedSettings.maxVisible) flags |= 40;
				appliedSettings = next;
				if (flags !== 0) schedule(flags);
			});
			const dispose = () => {
				if (!alive) return;
				alive = false;
				activation++;
				landing.cancel();
				clearPointer();
				motionPreference?.removeEventListener?.("change", motionChanged);
				if (binding?.session.sessionId === selection.getSnapshot()) owner.cancel();
				owner.release();
				sourceStop?.();
				listStop();
				selectedStop();
				settingsStop();
				structureDom.disconnect();
				nativeStructureDom.disconnect();
				attributeDom.disconnect();
				composerDom?.disconnect();
				resize?.disconnect();
				if (retry !== void 0) clearTimeout(retry);
				clearStreamRefresh(true);
				if (frame !== 0) window.cancelAnimationFrame(frame);
				scrollport.removeEventListener("scroll", onScroll);
				scrollport.removeEventListener("wheel", cancel);
				scrollport.removeEventListener("touchstart", readerPointer);
				scrollport.removeEventListener("pointerdown", readerPointer);
				scrollport.removeEventListener("keydown", readerKey);
				strip.remove();
				tooltip.remove();
				style.remove();
				if (forcedPosition && root.style.position === "relative") root.style.position = originalPosition;
				if (debugHost.__smcpDebug === debug) delete debugHost.__smcpDebug;
			};
			try {
				bind();
			} catch (error) {
				dispose();
				throw error;
			}
			return dispose;
		}
		//#endregion
		//#region package.json
		var name = "dsh-piano-nav";
		var version = "1.3.7";
		var homepage = "https://github.com/amazing-fish/dsh-piano-nav";
		var author = {
			"name": "amazing-fish",
			"url": "https://github.com/amazing-fish"
		};
		var bugs = { "url": "https://github.com/amazing-fish/dsh-piano-nav/issues" };
		var piano = {
			"displayName": "DSH Piano Navigator",
			"releaseDate": "—"
		};
		//#endregion
		//#region src/core/project.ts
		/** Public package identity shared by the built settings page and manifest. */
		const PROJECT = {
			title: piano.displayName,
			version: `v${version}`,
			releaseDate: piano.releaseDate,
			maintainer: author.name,
			repositoryUrl: homepage,
			issuesUrl: bugs.url,
			packageName: name,
			packageUrl: `https://www.npmjs.com/package/${name}`
		};
		//#endregion
		//#region src/client/settings-page.tsx
		const INSTALL_COMMAND = `dsh plugin --profile web add ${PROJECT.packageName}`;
		const LANGUAGE_OPTIONS = [
			{
				value: "zh",
				label: "简体中文"
			},
			{
				value: "en",
				label: "English"
			},
			{
				value: "zh-TW",
				label: "繁體中文"
			}
		];
		const FEEDBACK_KEYS = [
			"settings.writeError",
			"settings.copyError",
			"settings.loading",
			"settings.unavailable",
			"settings.saving"
		];
		const hostIsDark = () => typeof document !== "undefined" && document.body?.hasAttribute("data-ds-dark-theme") === true;
		const usePaletteEffect = typeof document === "undefined" ? react.useEffect : react.useLayoutEffect;
		const subscribeTheme = (listener) => {
			if (typeof MutationObserver === "undefined" || !document.body) return () => {};
			const observer = new MutationObserver(listener);
			observer.observe(document.body, {
				attributes: true,
				attributeFilter: ["data-ds-dark-theme"]
			});
			return () => observer.disconnect();
		};
		const DEMO_ITEMS = [
			"turn",
			"input",
			"output",
			"output",
			"output",
			"question",
			"answer",
			"final"
		].map((kind, i) => ({
			key: `demo:${i}`,
			kind: kind === "turn" ? void 0 : kind,
			turn: 1,
			role: kind === "turn" ? "turn" : kind === "input" || kind === "answer" ? "user" : "assistant",
			title: "",
			preview: "",
			anchorKey: null
		}));
		function kindLabel(kind, language) {
			return semanticLabel({
				kind: kind === "turn" ? void 0 : kind,
				role: kind === "turn" ? "turn" : "assistant"
			}, language);
		}
		function LayoutPreview({ settings }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const [selected, setSelected] = (0, react.useState)("demo:7");
			const slots = projectRailSlots(DEMO_ITEMS, -1, new Set(expanded ? DEMO_ITEMS.filter((item) => item.kind === "output").map((item) => item.key) : []), /* @__PURE__ */ new Set());
			const center = Math.max(0, railSlotIndex(slots, DEMO_ITEMS.findIndex((item) => item.key === selected)));
			const selectedSlotKey = slots[center].item.key;
			const range = visibleWindow(slots.length, center, settings.maxVisible);
			const visible = slots.slice(range.start, range.end);
			const height = Math.max(40, (Math.min(DEMO_ITEMS.length, settings.maxVisible) - 1) * settings.keyGap + settings.keyHeight);
			const positions = stackPositions(visible.length, height, settings.keyGap, settings.keyHeight);
			const t = (key) => translate(settings.language, key);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "smcp-preview smcp-unified",
				style: {
					"--smcp-preview-gap": `${settings.keyGap}px`,
					"--smcp-preview-key-height": `${settings.keyHeight}px`
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "smcp-preview-rail",
					style: { height },
					"aria-label": t("settings.preview"),
					children: visible.map((slot, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: `smcp-bar${slot.item.key === selectedSlotKey ? " smcp-bar-current" : ""}`,
						"aria-current": slot.item.key === selectedSlotKey ? "true" : void 0,
						"data-kind": slot.item.kind ?? "turn",
						"data-role": slot.item.role,
						"data-unloaded": slot.item.role === "turn",
						style: {
							top: positions[i] - settings.keyHeight / 2,
							height: settings.keyHeight,
							width: slot.item.key === selectedSlotKey ? 48 : 28
						},
						"aria-label": `${kindLabel(slot.item.kind ?? "turn", settings.language)}${slot.end - slot.start > 1 ? ` · ${t("settings.folded")}` : ""}`,
						title: kindLabel(slot.item.kind ?? "turn", settings.language),
						onClick: () => {
							setSelected(slot.item.key);
							setExpanded(slot.item.kind === "output" && (expanded || slot.end - slot.start > 1));
						}
					}, slot.item.key))
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "smcp-preview-copy",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("settings.preview") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("settings.previewDesc") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
							"aria-live": "polite",
							children: kindLabel(DEMO_ITEMS.find((item) => item.key === selected)?.kind ?? "turn", settings.language)
						}),
						DEMO_ITEMS.length > settings.maxVisible && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "smcp-preview-pages",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => setSelected(slots[0].item.key),
								children: t("settings.first")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => setSelected(slots.at(-1).item.key),
								children: t("settings.last")
							})]
						})
					]
				})]
			});
		}
		function RangeRow(props) {
			const { label, description, value, min, max, suffix, disabled, onChange } = props;
			const change = (event) => {
				onChange(Number.parseInt(event.target.value, 10));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: "smcp-settings-row",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "smcp-settings-copy",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "smcp-settings-label",
						children: label
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "smcp-settings-description",
						children: description
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "smcp-settings-range",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "range",
						min,
						max,
						step: 1,
						value,
						disabled,
						onChange: change
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("output", { children: [value, suffix] })]
				})]
			});
		}
		/** The controller shares the latest choice with every color consumer. */
		function ColorInput({ value, label, disabled, onCommit }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
				type: "color",
				"aria-label": label,
				value,
				disabled,
				onChange: (event) => {
					onCommit(event.target.value);
				}
			});
		}
		/** Select only the state this component renders; retain identity on other edits. */
		function useSettingsSelector(scope, select, equal = Object.is) {
			const cached = (0, react.useRef)();
			const subscribe = (0, react.useCallback)((listener) => scope.subscribe(listener), [scope]);
			const getSnapshot = () => {
				const value = select(scope.getSnapshot());
				if (cached.current === void 0 || !equal(cached.current.value, value)) cached.current = { value };
				return cached.current.value;
			};
			return (0, react.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
		}
		const pageSnapshotEqual = (a, b) => a.status === b.status && a.writable === b.writable && a.saving === b.saving && a.value.language === b.value.language && a.value.enabled === b.value.enabled && a.value.keyHeight === b.value.keyHeight && a.value.keyGap === b.value.keyGap && a.value.maxVisible === b.value.maxVisible;
		function ColorRow({ scope, kind, language, dark, disabled, save }) {
			const field = COLOR_FIELDS[kind];
			const value = useSettingsSelector(scope, (snapshot) => snapshot.value[field]);
			const label = kindLabel(kind, language), themeColor = translate(language, "settings.themeColor");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "smcp-color-row",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "smcp-color-label",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "smcp-legend-key smcp-bar",
							"data-kind": kind,
							"data-unloaded": kind === "turn",
							"aria-hidden": "true",
							style: paletteStyle({ [field]: value })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [label, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: value || themeColor })] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ColorInput, {
							label,
							value: value || THEME_COLORS[dark ? "dark" : "light"][kind][0],
							disabled,
							onCommit: (color) => save(scope.set(field, color))
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "smcp-color-auto",
					disabled: disabled || !value,
					"aria-label": `${label} · ${themeColor}`,
					onClick: () => save(scope.set(field, "")),
					children: translate(language, "settings.auto")
				})]
			});
		}
		function PianoSettingsPage(props) {
			const { scope } = props;
			const snapshot = useSettingsSelector(scope, (snapshot) => snapshot, pageSnapshotEqual);
			const settings = decodeSettings(snapshot.value) ?? DEFAULT_SETTINGS;
			const t = (key) => translate(settings.language, key);
			const [error, setError] = (0, react.useState)(null);
			const [copied, setCopied] = (0, react.useState)(false);
			const copyGeneration = (0, react.useRef)(0);
			const dark = (0, react.useSyncExternalStore)(subscribeTheme, hostIsDark, () => false);
			const disabled = !snapshot.writable;
			const paletteRoot = (0, react.useRef)(null);
			usePaletteEffect(() => {
				const root = paletteRoot.current;
				if (root === null) return;
				let previous = scope.getSnapshot().value;
				syncPalette(root.style, previous);
				return scope.subscribe(() => {
					const next = scope.getSnapshot().value;
					syncPalette(root.style, next, previous);
					previous = next;
				});
			}, [scope]);
			const saveHandlers = (0, react.useRef)(/* @__PURE__ */ new WeakMap());
			const save = (0, react.useCallback)((operation) => {
				const existing = saveHandlers.current.get(operation);
				if (existing !== void 0) return existing;
				const handled = operation.then(() => {
					setError((current) => current === "settings.writeError" ? null : current);
				}).catch(() => {
					setError("settings.writeError");
				});
				saveHandlers.current.set(operation, handled);
				return handled;
			}, []);
			const write = (field, value) => save(scope.set(field, value));
			const reset = () => {
				save(scope.reset());
			};
			const copyCommand = () => {
				const ticket = ++copyGeneration.current;
				setCopied(false);
				(async () => {
					try {
						if (window.navigator.clipboard === void 0) throw new Error("clipboard unavailable");
						await window.navigator.clipboard.writeText(INSTALL_COMMAND);
						if (ticket !== copyGeneration.current) return;
						setCopied(true);
						setError((current) => current === "settings.copyError" ? null : current);
					} catch {
						if (ticket === copyGeneration.current) setError("settings.copyError");
					}
				})();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "smcp-settings-page",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: SEMANTIC_CSS }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "smcp-settings-hero",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
								src: icon_default,
								alt: "",
								className: "smcp-settings-icon"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "smcp-settings-hero-copy",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "smcp-settings-title",
									children: PROJECT.title
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "smcp-settings-subtitle",
									children: t("settings.subtitle")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "smcp-settings-switch",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: settings.enabled,
										disabled,
										onChange: (event) => {
											write("enabled", event.target.checked);
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { "aria-hidden": "true" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: settings.enabled ? t("settings.enabled") : t("settings.disabled") })
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "smcp-settings-feedback",
						children: [
							FEEDBACK_KEYS.map((key) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "smcp-settings-feedback-reserve",
								"aria-hidden": "true",
								children: t(key)
							}, key)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "smcp-settings-error smcp-settings-page-error",
								role: "alert",
								children: error === null ? "" : t(error)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "smcp-settings-note",
								role: "status",
								children: error !== null ? "" : snapshot.status === "loading" ? t("settings.loading") : snapshot.status === "unavailable" ? t("settings.unavailable") : snapshot.saving ? t("settings.saving") : ""
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
						className: "smcp-settings-card smcp-unified",
						ref: paletteRoot,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LayoutPreview, { settings })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "smcp-settings-card smcp-unified",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("settings.colors") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "smcp-settings-note",
								children: t("settings.colorsDesc")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "smcp-color-grid",
								children: SEMANTIC_KINDS.map((kind) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ColorRow, {
									scope,
									kind,
									language: settings.language,
									dark,
									disabled,
									save
								}, kind))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "smcp-settings-reset",
								disabled,
								onClick: () => {
									save(scope.reset(Object.values(COLOR_FIELDS)));
								},
								children: t("settings.resetColors")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "smcp-settings-card smcp-settings-general",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("settings.general") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "smcp-settings-row smcp-settings-language",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "smcp-settings-label",
								children: "语言/Language"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
								className: "smcp-settings-select",
								value: settings.language,
								disabled,
								onChange: (event) => {
									if (isPianoLanguage(event.target.value)) write("language", event.target.value);
								},
								children: LANGUAGE_OPTIONS.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: option.value,
									children: option.label
								}, option.value))
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "smcp-settings-card",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("settings.appearance") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RangeRow, {
								label: t("settings.height"),
								description: t("settings.heightDesc"),
								value: settings.keyHeight,
								min: SETTINGS_LIMITS.keyHeight.min,
								max: SETTINGS_LIMITS.keyHeight.max,
								suffix: "px",
								disabled,
								onChange: (value) => {
									write("keyHeight", value);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RangeRow, {
								label: t("settings.gap"),
								description: t("settings.gapDesc"),
								value: settings.keyGap,
								min: SETTINGS_LIMITS.keyGap.min,
								max: SETTINGS_LIMITS.keyGap.max,
								suffix: "px",
								disabled,
								onChange: (value) => {
									write("keyGap", value);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RangeRow, {
								label: t("settings.maxVisible"),
								description: t("settings.maxVisibleDesc"),
								value: settings.maxVisible,
								min: SETTINGS_LIMITS.maxVisible.min,
								max: SETTINGS_LIMITS.maxVisible.max,
								suffix: "",
								disabled,
								onChange: (value) => {
									write("maxVisible", value);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "smcp-settings-total",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("settings.totalHeight") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [railHeight(settings), "px"] })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "smcp-settings-reset",
								disabled,
								onClick: reset,
								children: t("settings.reset")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: "smcp-settings-card smcp-settings-help",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: t("settings.guide") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("settings.guideHistory") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("settings.guideFold") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("settings.guideKeys") })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "smcp-settings-card smcp-settings-about",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("settings.about") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("settings.version") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: PROJECT.version })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("settings.releaseDate") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: PROJECT.releaseDate })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("settings.author") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: PROJECT.maintainer })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("settings.feedback") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								href: PROJECT.issuesUrl,
								target: "_blank",
								rel: "noreferrer",
								children: "GitHub Issues"
							}) })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "GitHub" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								href: PROJECT.repositoryUrl,
								target: "_blank",
								rel: "noreferrer",
								children: PROJECT.repositoryUrl
							}) })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "npm" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								href: PROJECT.packageUrl,
								target: "_blank",
								rel: "noreferrer",
								children: PROJECT.packageName
							}) })] })
						] })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "smcp-settings-card smcp-settings-install",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("settings.install") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "smcp-settings-command-box",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: INSTALL_COMMAND }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: copyCommand,
								children: copied ? t("settings.copied") : t("settings.copy")
							})]
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/styles.ts
		/** Codex-like conversation navigator visuals. */
		const CSS = `
		.smcp-strip {
		  position: absolute;
		  top: 50%;
		  width: 58px;
		  transform: translateY(-50%);
		  z-index: 20;
		  pointer-events: auto;
		  touch-action: none;
		  outline: none;
		}
		.smcp-strip:focus-visible::before {
		  content: '';
		  position: absolute;
		  inset: -6px -4px;
		  border: 1px solid var(--dsw-alias-border-focus, rgba(32, 94, 238, .5));
		  border-radius: 8px;
		}
		.smcp-bar {
		  appearance: none;
		  position: absolute;
		  left: 0;
		  min-width: 0;
		  margin: 0;
		  padding: 0;
		  border: 0;
		  border-radius: 999px;
		  background: var(--smcp-key, #c9c9cc);
		  opacity: .78;
		  pointer-events: none;
		  transform-origin: left center;
		  transition: width 82ms cubic-bezier(.2, .8, .2, 1);
		}
		/* Pointer-driven widths are already synchronized to animation frames. */
		.smcp-pointer-follow .smcp-bar,
		.smcp-pointer-frame .smcp-bar { transition: none; }
		.smcp-bar-current,
		.smcp-bar-hover {
		  background: var(--smcp-key-active, #202124);
		  opacity: 1;
		}
		.smcp-strip-hidden { display: none; }
		.smcp-bar[disabled] { opacity: .3; }
		.smcp-tooltip {
		  position: absolute;
		  z-index: 30;
		  box-sizing: border-box;
		  width: min(560px, calc(100vw - 32px));
		  max-height: 224px;
		  padding: 15px 16px 16px;
		  overflow: hidden;
		  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .11));
		  border-radius: 16px;
		  /* Preview cards keep a neutral surface even when the host's layer is tinted. */
		  background: rgba(255, 255, 255, .98);
		  box-shadow: 0 8px 28px rgba(0, 0, 0, .10), 0 2px 8px rgba(0, 0, 0, .05);
		  color: var(--dsw-alias-label-primary, #202124);
		  opacity: 0;
		  visibility: hidden;
		  pointer-events: none;
		  transform: translateX(-5px);
		  transition: opacity 90ms ease, transform 110ms cubic-bezier(.2, .8, .2, 1), visibility 0s linear 110ms;
		}
		.smcp-tooltip-visible {
		  opacity: 1;
		  visibility: visible;
		  transform: translateX(0);
		  transition-delay: 0s;
		}
		.smcp-tooltip-title {
		  display: block;
		  overflow: hidden;
		  color: var(--dsw-alias-label-primary, #202124);
		  font-size: 14px;
		  font-weight: 400;
		  line-height: 21px;
		  text-overflow: ellipsis;
		  white-space: nowrap;
		}
		.smcp-tooltip-body {
		  display: -webkit-box;
		  margin-top: 8px;
		  overflow: hidden;
		  color: var(--dsw-alias-label-secondary, #73757a);
		  font-size: 13px;
		  line-height: 20px;
		  white-space: pre-wrap;
		  overflow-wrap: anywhere;
		  -webkit-box-orient: vertical;
		  -webkit-line-clamp: 7;
		}
		.smcp-settings-page {
		  box-sizing: border-box;
		  width: 100%;
		  max-width: 720px;
		  padding: 8px 0 36px;
		  color: var(--dsw-alias-label-primary, #202124);
		}
		.smcp-settings-page *,
		.smcp-settings-page *::before,
		.smcp-settings-page *::after { box-sizing: border-box; }
		.smcp-settings-hero {
		  display: flex;
		  align-items: center;
		  gap: 14px;
		  margin-bottom: 16px;
		  padding: 16px;
		  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .10));
		  border-radius: 16px;
		  background: var(--dsw-alias-bg-layer-2, #fff);
		  min-width: 0;
		}
		.smcp-settings-icon {
		  box-sizing: border-box;
		  width: 54px;
		  height: 54px;
		  padding: 5px;
		  object-fit: contain;
		  flex: none;
		}
		.smcp-settings-hero-copy,
		.smcp-settings-copy {
		  display: flex;
		  min-width: 0;
		  flex: 1;
		  flex-direction: column;
		}
		.smcp-settings-title {
		  font-size: 16px;
		  font-weight: 600;
		  line-height: 24px;
		  overflow-wrap: anywhere;
		}
		.smcp-settings-subtitle,
		.smcp-settings-description,
		.smcp-settings-note {
		  color: var(--dsw-alias-label-secondary, #73757a);
		  font-size: 12px;
		  line-height: 18px;
		}
		.smcp-settings-card {
		  position: relative;
		  min-width: 0;
		  margin-top: 12px;
		  padding: 16px;
		  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .10));
		  border-radius: 16px;
		  background: var(--dsw-alias-bg-layer-2, #fff);
		}
		.smcp-settings-card h2 {
		  margin: 0 0 8px;
		  font-size: 14px;
		  font-weight: 600;
		  line-height: 22px;
		}
		.smcp-settings-row {
		  display: flex;
		  min-width: 0;
		  align-items: center;
		  gap: 24px;
		  min-height: 58px;
		  border-top: 1px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, .06));
		}
		.smcp-settings-label {
		  font-size: 13px;
		  line-height: 20px;
		}
		.smcp-settings-language { justify-content: space-between; }
		.smcp-settings-select {
		  width: 190px;
		  max-width: 100%;
		  min-height: 34px;
		  padding: 6px 30px 6px 10px;
		  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .14));
		  border-radius: 9px;
		  background: var(--dsw-alias-bg-layer-2, #fff);
		  color: var(--dsw-alias-label-primary, #202124);
		  cursor: pointer;
		  font: inherit;
		  font-size: 12px;
		}
		.smcp-settings-select:focus-visible { outline: 2px solid var(--dsw-alias-border-focus, #4c7ef3); outline-offset: 1px; }
		.smcp-settings-select:disabled { opacity: .45; cursor: not-allowed; }
		.smcp-settings-range {
		  display: grid;
		  grid-template-columns: 150px 44px;
		  align-items: center;
		  gap: 10px;
		  flex: none;
		}
		.smcp-settings-range input {
		  width: 150px;
		  accent-color: #111;
		}
		.smcp-settings-range output {
		  color: var(--dsw-alias-label-secondary, #73757a);
		  font-size: 12px;
		  font-variant-numeric: tabular-nums;
		  text-align: right;
		}
		.smcp-settings-switch {
		  display: flex;
		  align-items: center;
		  gap: 8px;
		  cursor: pointer;
		  flex: none;
		}
		.smcp-settings-switch input {
		  position: absolute;
		  opacity: 0;
		  pointer-events: none;
		}
		.smcp-settings-switch > span {
		  position: relative;
		  width: 34px;
		  height: 20px;
		  border-radius: 999px;
		  background: var(--dsw-alias-border-l2, #c6c7ca);
		  transition: background-color .15s ease;
		}
		.smcp-settings-switch > span::after {
		  content: '';
		  position: absolute;
		  top: 3px;
		  left: 3px;
		  width: 14px;
		  height: 14px;
		  border-radius: 50%;
		  background: #fff;
		  box-shadow: 0 1px 3px rgba(0, 0, 0, .18);
		  transition: transform .15s ease;
		}
		.smcp-settings-switch input:checked + span { background: #161719; }
		.smcp-settings-switch input:checked + span::after { transform: translateX(14px); }
		.smcp-settings-switch input:focus-visible + span { outline: 2px solid var(--dsw-alias-border-focus, #4c7ef3); outline-offset: 2px; }
		.smcp-settings-switch input:disabled + span,
		.smcp-settings-row input:disabled { opacity: .45; cursor: not-allowed; }
		.smcp-settings-switch b {
		  min-width: 44px;
		  font-size: 12px;
		  font-weight: 400;
		}
		.smcp-settings-total {
		  display: flex;
		  gap: 16px;
		  justify-content: space-between;
		  padding-top: 12px;
		  border-top: 1px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, .06));
		  color: var(--dsw-alias-label-secondary, #73757a);
		  font-size: 12px;
		}
		.smcp-settings-total strong { color: var(--dsw-alias-label-primary, #202124); font-weight: 500; }
		.smcp-settings-reset {
		  margin-top: 14px;
		  padding: 7px 12px;
		  border: 1px solid #161719;
		  border-radius: 9px;
		  background: #161719;
		  color: #fff;
		  cursor: pointer;
		}
		.smcp-settings-reset:hover:not(:disabled) { background: #2c2d30; border-color: #2c2d30; }
		.smcp-settings-reset:disabled { opacity: .45; cursor: not-allowed; }
		.smcp-settings-error { margin: 10px 0 0; color: var(--dsw-alias-state-danger, #d93025); font-size: 12px; }
		.smcp-settings-note { margin: 10px 0 0; }
		.smcp-settings-feedback { display: grid; }
		.smcp-settings-feedback > p { grid-area: 1 / 1; margin: 0; min-width: 0; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
		.smcp-settings-feedback-reserve { visibility: hidden; }
		.smcp-settings-about dl { margin: 0; }
		.smcp-settings-about dl > div {
		  display: grid;
		  grid-template-columns: 110px minmax(0, 1fr);
		  gap: 16px;
		  padding: 7px 0;
		  font-size: 12px;
		}
		.smcp-settings-about dt { color: var(--dsw-alias-label-secondary, #73757a); }
		.smcp-settings-about dd { margin: 0; overflow-wrap: anywhere; }
		.smcp-settings-about a { color: inherit; }
		.smcp-settings-command-box {
		  display: grid;
		  grid-template-columns: minmax(0, 1fr) auto;
		  align-items: center;
		  gap: 14px;
		  min-width: 0;
		  padding: 7px 7px 7px 12px;
		  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .10));
		  border-radius: 10px;
		  background: #f3f3f4;
		  font-size: 12px;
		}
		.smcp-settings-command-box code {
		  display: block;
		  min-width: 0;
		  color: #1a1c1f;
		  overflow-wrap: anywhere;
		  white-space: pre-wrap;
		  word-break: break-word;
		}
		.smcp-settings-command-box button {
		  flex: none;
		  padding: 5px 9px;
		  border: 1px solid #161719;
		  border-radius: 7px;
		  background: #161719;
		  color: #fff;
		  cursor: pointer;
		  font-size: 12px;
		  white-space: nowrap;
		}
		.smcp-settings-command-box button:hover { background: #2c2d30; border-color: #2c2d30; }
		.smcp-settings-command-box button:focus-visible { outline: 2px solid var(--dsw-alias-border-focus, #4c7ef3); outline-offset: 1px; }
		body[data-ds-dark-theme] .smcp-bar {
		  --smcp-key: rgba(255, 255, 255, .32);
		  --smcp-key-active: rgba(255, 255, 255, .94);
		}
		body[data-ds-dark-theme] .smcp-tooltip {
		  background: rgba(35, 35, 39, .98);
		  border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, .10));
		  box-shadow: 0 10px 32px rgba(0, 0, 0, .34);
		}
		body[data-ds-dark-theme] .smcp-settings-switch input:checked + span { background: #f1f1f3; }
		body[data-ds-dark-theme] .smcp-settings-switch input:checked + span::after { background: #202124; }
		body[data-ds-dark-theme] .smcp-settings-command-box { background: rgba(255, 255, 255, .08); }
		body[data-ds-dark-theme] .smcp-settings-command-box code { color: #f1f1f3; }
		@media (max-width: 760px) {
		  .smcp-settings-row { align-items: flex-start; flex-direction: column; gap: 8px; padding: 12px 0; }
		  .smcp-settings-language { align-items: center; flex-direction: row; }
		  .smcp-settings-range { width: 100%; grid-template-columns: minmax(0, 1fr) 44px; }
		  .smcp-settings-range input { width: 100%; }
		}
		@media (max-width: 520px) {
		  .smcp-settings-hero { align-items: flex-start; flex-wrap: wrap; gap: 12px; padding: 14px; }
		  .smcp-settings-icon { width: 48px; height: 48px; padding: 4px; }
		  .smcp-settings-hero-copy { flex-basis: calc(100% - 60px); }
		  .smcp-settings-switch {
		    width: 100%;
		    justify-content: flex-end;
		    padding-top: 10px;
		    border-top: 1px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, .06));
		  }
		  .smcp-settings-card { padding: 14px; }
		  .smcp-settings-about dl > div { grid-template-columns: 88px minmax(0, 1fr); gap: 10px; }
		  .smcp-settings-command-box { align-items: start; }
		}
		@media (max-width: 360px) {
		  .smcp-settings-language { align-items: flex-start; flex-direction: column; }
		  .smcp-settings-select { width: 100%; }
		  .smcp-settings-about dl > div { grid-template-columns: minmax(0, 1fr); gap: 2px; }
		  .smcp-settings-total { align-items: flex-start; flex-direction: column; gap: 4px; }
		  .smcp-settings-command-box { gap: 10px; padding-left: 10px; }
		}
		/* Preview uses the rail's shared semantic CSS and projection. */
		.smcp-preview { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 16px; align-items: center; }
		.smcp-preview-rail { position: relative; width: 80px; min-height: 40px; }
		.smcp-preview-rail .smcp-bar { left: 12px; pointer-events: auto; transition: top 100ms ease-out, width 82ms cubic-bezier(.2, .8, .2, 1); }
		.smcp-preview-rail .smcp-bar::after { content: ''; position: absolute; inset: calc((var(--smcp-preview-key-height) - var(--smcp-preview-gap)) / 2) 0; }
		.smcp-preview-rail .smcp-bar:focus-visible { outline: 2px solid var(--dsw-alias-border-focus, #4c7ef3); outline-offset: 3px; }
		.smcp-preview-copy p, .smcp-settings-help p { font-size: 13px; line-height: 1.65; color: var(--dsw-alias-label-secondary, #73757a); }
		.smcp-preview-copy p { margin: 6px 0; }
		.smcp-preview-copy strong { font-size: 13px; }
		.smcp-preview-pages { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
		.smcp-preview-pages button, .smcp-color-auto { font: inherit; font-size: 12px; padding: 5px 8px; border: 1px solid var(--dsw-alias-border-l2, #c9c9cc); border-radius: 6px; color: inherit; background: transparent; cursor: pointer; }
		.smcp-color-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 24px; }
		.smcp-color-row { min-width: 0; display: flex; gap: 8px; align-items: center; border-bottom: 1px solid var(--dsw-alias-border-l4, rgba(127,127,127,.15)); padding: 12px 0; }
		.smcp-color-label { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
		.smcp-color-label > span:nth-child(2) { flex: 1; font-size: 13px; min-width: 0; overflow-wrap: anywhere; }
		.smcp-color-label small { display: block; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary, #73757a); margin-top: 3px; }
		.smcp-unified .smcp-legend-key { display: block; position: static; width: 24px; height: 3px; flex: none; }
		.smcp-color-label input { width: 32px; height: 32px; flex: none; border: 1px solid var(--dsw-alias-border-l2, #c9c9cc); border-radius: 6px; padding: 2px; background: transparent; cursor: pointer; }
		.smcp-color-label input:disabled, .smcp-color-auto:disabled { cursor: not-allowed; opacity: .45; }
		.smcp-settings-help summary { cursor: pointer; font-size: 14px; font-weight: 600; }
		@media (max-width: 600px) { .smcp-color-grid { grid-template-columns: minmax(0, 1fr); } }
		@media (max-width: 360px) { .smcp-preview { grid-template-columns: 60px minmax(0, 1fr); gap: 8px; } .smcp-preview-rail { width: 60px; } }
		@media (prefers-reduced-motion: reduce) {
		  .smcp-bar, .smcp-preview-rail .smcp-bar, .smcp-tooltip, .smcp-settings-switch > span, .smcp-settings-switch > span::after { transition: none; }
		}
		`;
		const STYLE_ID = "smcp-panel-styles";
		function installStyles() {
			if (document.getElementById(STYLE_ID) === null) {
				const style = document.createElement("style");
				style.id = STYLE_ID;
				style.textContent = CSS;
				document.head.appendChild(style);
			}
			return () => document.getElementById(STYLE_ID)?.remove();
		}
		//#endregion
		//#region src/client/index.ts
		/** Services supplied by the explicitly ordered client packages. */
		const inject = [
			"sessions",
			"uiConversation",
			"locale",
			"slots",
			"remote",
			"remote.settings"
		];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, dictionaries$1), "dsh-piano-nav: dictionaries");
			ctx.effect(() => installStyles(), "dsh-piano-nav: styles");
			const t = ctx.locale.bind(NS);
			const selected = createSelectedSessionSource();
			const settings = createPianoRemoteSettings(ctx.remote);
			ctx.effect(() => () => settings.dispose(), "dsh-piano-nav: settings remote");
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "sm-context-piano-session-probe",
				inject: () => ({ activate: selected.activate })
			}, SessionProbe));
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "sm-context-piano",
				order: 21,
				label: () => t("settings.nav"),
				inject: () => ({ scope: settings.scope })
			}, PianoSettingsPage));
			ctx.effect(() => attachKeyStrip(ctx, t, selected.source, settings.source), "dsh-piano-nav: navigator strip");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
