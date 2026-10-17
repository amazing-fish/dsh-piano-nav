/** Persisted semantic overrides. Empty means follow the host's current theme. */
export const COLOR_FIELDS = {
  input: 'colorInput', output: 'colorOutput', question: 'colorQuestion',
  answer: 'colorAnswer', final: 'colorFinal', turn: 'colorHistory',
} as const
export type SemanticKind = keyof typeof COLOR_FIELDS
export type PianoColorField = typeof COLOR_FIELDS[SemanticKind]
export type PianoColors = Record<PianoColorField, string>
export const SEMANTIC_KINDS = Object.keys(COLOR_FIELDS) as SemanticKind[]
export const COLOR_PATTERN = /^(?:|#[0-9a-fA-F]{6})$/
export const DEFAULT_COLORS: PianoColors = {
  colorInput: '', colorOutput: '', colorQuestion: '', colorAnswer: '', colorFinal: '', colorHistory: '',
}
export const THEME_COLORS = {
  light: {
    input: ['#2563eb', '#1d4ed8'], output: ['#8a8a8a', '#6b6b6b'],
    question: ['#b45309', '#92400e'], answer: ['#15803d', '#166534'],
    final: ['#7c3aed', '#6d28d9'], turn: ['#202124', '#000000'],
  },
  dark: {
    input: ['#60a5fa', '#93c5fd'], output: ['#e5e5e5', '#ffffff'],
    question: ['#fbbf24', '#fde68a'], answer: ['#4ade80', '#86efac'],
    final: ['#a78bfa', '#c4b5fd'], turn: ['#f1f1f3', '#ffffff'],
  },
} as const
export function isPianoColor(value: unknown): value is string {
  return typeof value === 'string' && COLOR_PATTERN.test(value)
}

/** Same CSS variables on the rail, legend and preview; never accepts arbitrary CSS. */
export function paletteStyle(settings: Partial<PianoColors>): Record<string, string> {
  const style: Record<string, string> = {}
  for (const kind of SEMANTIC_KINDS) {
    const value = settings[COLOR_FIELDS[kind]]
    if (value && isPianoColor(value)) {
      style[`--smcp-${kind}-color`] = value
      style[`--smcp-${kind}-active-color`] = `color-mix(in srgb, ${value} 76%, var(--smcp-active-mix, #000))`
    }
  }
  return style
}
