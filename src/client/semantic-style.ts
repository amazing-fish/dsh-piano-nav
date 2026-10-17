/** Speaker colours survive active/hover states, with semantic text as a non-colour cue. */
import type { PianoLanguage } from '../core/config.ts'
import type { PianoItem } from './navigation-model.ts'

import { SEMANTIC_KINDS, THEME_COLORS } from '../core/colors.ts'
const paletteRules = (dark: boolean): string => SEMANTIC_KINDS.map(kind => {
  const [normal, active] = THEME_COLORS[dark ? 'dark' : 'light'][kind]
  const legacy = kind === 'input' ? 'user' : kind === 'final' ? 'assistant' : null
  const normalFallback = legacy ? `var(--smcp-${legacy}-color, ${normal})` : normal
  const activeFallback = legacy ? `var(--smcp-${legacy}-active-color, ${active})` : active
  return `${dark ? 'body[data-ds-dark-theme] ' : ''}.smcp-unified .smcp-bar[data-kind="${kind}"] {
    --smcp-key: var(--smcp-${kind}-color, ${normalFallback});
    --smcp-key-active: var(--smcp-${kind}-active-color, ${activeFallback});
    color: var(--smcp-key); ${kind === 'turn' ? '' : 'opacity: 1;'}
  }`
}).join('\n')
export const SEMANTIC_CSS = `
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
`
const dictionaries = {
  en: { input: 'User · Input', output: 'AI · Output', final: 'AI · Final result', question: 'AI · Question', answer: 'User · Answer', turn: 'History turn', pending: 'Awaiting your answer', answered: 'Answered', unanswered: 'No valid answer recorded', error: 'Question cancelled or failed', missing: 'The target could not be revealed. Retry or open the native transcript.' },
  zh: { input: '用户 · 输入', output: 'AI · 输出', final: 'AI · 最终结果', question: 'AI · 提问', answer: '用户 · 回答', turn: '历史轮次', pending: '等待你回答', answered: '已回答', unanswered: '未记录有效回答', error: '提问已取消或失败', missing: '目标暂时无法展开，请重试或查看原生正文。' },
  'zh-TW': { input: '使用者 · 輸入', output: 'AI · 輸出', final: 'AI · 最終結果', question: 'AI · 提問', answer: '使用者 · 回答', turn: '歷史輪次', pending: '等待你回答', answered: '已回答', unanswered: '未記錄有效回答', error: '提問已取消或失敗', missing: '目標暫時無法展開，請重試或查看原生正文。' },
} as const
export function semanticLabel(item: Pick<PianoItem, 'kind' | 'role' | 'interactionState'>, language: PianoLanguage): string {
  const copy = dictionaries[language]
  const kind = item.kind ?? (item.role === 'turn' ? 'turn' : item.role === 'user' ? 'input' : 'output')
  return copy[kind] + (item.interactionState === undefined ? '' : ` · ${copy[item.interactionState]}`)
}
export function landingFailure(language: PianoLanguage): string { return dictionaries[language].missing }
