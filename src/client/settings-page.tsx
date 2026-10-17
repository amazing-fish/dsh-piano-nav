import { useCallback, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent, CSSProperties, ReactNode } from 'react'
import type {
  InjectFace,
  PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import iconUrl from '../../assets/icon.png'
import {
  DEFAULT_SETTINGS,
  SETTINGS_LIMITS,
  decodeSettings,
  isPianoLanguage,
  railHeight,
} from '../core/config.ts'
import type {
  PianoLanguage,
  PianoSettings,
  PianoSettingsScope,
} from '../core/config.ts'
import { COLOR_FIELDS, DEFAULT_COLORS, SEMANTIC_KINDS, THEME_COLORS, paletteStyle } from '../core/colors.ts'
import type { SemanticKind } from '../core/colors.ts'
import { SEMANTIC_CSS, semanticLabel } from './semantic-style.ts'
import type { PianoItem } from './navigation-model.ts'
import { projectRailSlots } from './rail-slots.ts'
import { stackPositions, visibleWindow } from './strip.ts'
import { PROJECT } from '../core/project.ts'
import { translate } from './locales.ts'
import type { SmContextPianoKey } from './locales.ts'

const INSTALL_COMMAND = `dsh plugin --profile web add ${PROJECT.packageName}`
const LANGUAGE_OPTIONS: readonly { value: PianoLanguage; label: string }[] = [
  { value: 'zh', label: '简体中文' },
  { value: 'en', label: 'English' },
  { value: 'zh-TW', label: '繁體中文' },
]
type SettingsErrorKey = 'settings.writeError' | 'settings.copyError'
const hostIsDark = (): boolean => typeof document !== 'undefined' && document.body?.hasAttribute('data-ds-dark-theme') === true
const subscribeTheme = (listener: () => void): (() => void) => {
  if (typeof MutationObserver === 'undefined' || !document.body) return () => {}
  const observer = new MutationObserver(listener)
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  return () => observer.disconnect()
}

const DEMO_ITEMS: PianoItem[] = (['turn', 'input', 'output', 'output', 'output', 'question', 'answer', 'final'] as const).map((kind, i) => ({
  key: `demo:${i}`, kind: kind === 'turn' ? undefined : kind, turn: 1, role: kind === 'turn' ? 'turn' : kind === 'input' || kind === 'answer' ? 'user' : 'assistant',
  title: '', preview: '', anchorKey: null,
}))
function kindLabel(kind: SemanticKind, language: PianoLanguage): string {
  return semanticLabel({ kind: kind === 'turn' ? undefined : kind, role: kind === 'turn' ? 'turn' : 'assistant' }, language)
}
function LayoutPreview({ settings }: { settings: PianoSettings }): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState('demo:7')
  const slots = projectRailSlots(DEMO_ITEMS, -1, new Set(expanded ? DEMO_ITEMS.filter(item => item.kind === 'output').map(item => item.key) : []), new Set())
  const center = Math.max(0, slots.findIndex(slot => slot.item.key === selected))
  const range = visibleWindow(slots.length, center, settings.maxVisible)
  const visible = slots.slice(range.start, range.end)
  const height = Math.min(railHeight(settings), 240)
  const positions = stackPositions(visible.length, height, settings.keyGap, settings.keyHeight)
  const t = (key: SmContextPianoKey): string => translate(settings.language, key)
  return <div className="smcp-preview smcp-unified" style={{ ...paletteStyle(settings), '--smcp-preview-gap': `${settings.keyGap}px`, '--smcp-preview-key-height': `${settings.keyHeight}px` } as CSSProperties}>
    <div className="smcp-preview-rail" style={{ height }} aria-label={t('settings.preview')}>
      {visible.map((slot, i) => <button type="button" key={slot.item.key}
        className={`smcp-bar${slot.item.key === selected ? ' smcp-bar-current' : ''}`}
        data-kind={slot.item.kind ?? 'turn'} data-role={slot.item.role}
        style={{ top: positions[i] - settings.keyHeight / 2, height: settings.keyHeight, width: slot.item.key === selected ? 48 : 28 }}
        aria-label={`${kindLabel(slot.item.kind ?? 'turn', settings.language)}${slot.end - slot.start > 1 ? ` · ${t('settings.folded')}` : ''}`}
        title={kindLabel(slot.item.kind ?? 'turn', settings.language)}
        onClick={() => { setSelected(slot.item.key); setExpanded(slot.end - slot.start > 1) }} />)}
    </div>
    <div className="smcp-preview-copy">
      <h2>{t('settings.preview')}</h2>
      <p>{t('settings.previewDesc')}</p>
      <strong aria-live="polite">{kindLabel(DEMO_ITEMS.find(item => item.key === selected)?.kind ?? 'final', settings.language)}</strong>
      {slots.length > settings.maxVisible && <div className="smcp-preview-pages">
        <button type="button" onClick={() => setSelected(slots[0].item.key)}>{t('settings.first')}</button>
        <button type="button" onClick={() => setSelected(slots.at(-1)!.item.key)}>{t('settings.last')}</button>
      </div>}
    </div>
  </div>
}

export interface PianoSettingsPageInjected {
  scope: PianoSettingsScope
}

export type PianoSettingsPageProps =
  PropsRuntime<'settings.section'>
  & InjectFace<PianoSettingsPageInjected>

interface RangeRowProps {
  label: string
  description: string
  value: number
  min: number
  max: number
  suffix: string
  disabled: boolean
  onChange: (value: number) => void
}

function RangeRow(props: RangeRowProps): ReactNode {
  const { label, description, value, min, max, suffix, disabled, onChange } = props
  const change = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange(Number.parseInt(event.target.value, 10))
  }
  return (
    <label className="smcp-settings-row">
      <span className="smcp-settings-copy">
        <span className="smcp-settings-label">{label}</span>
        <span className="smcp-settings-description">{description}</span>
      </span>
      <span className="smcp-settings-range">
        <input type="range" min={min} max={max} step={1} value={value} disabled={disabled} onChange={change} />
        <output>{value}{suffix}</output>
      </span>
    </label>
  )
}

export function PianoSettingsPage(props: PianoSettingsPageProps): ReactNode {
  const { scope } = props
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const getSnapshot = useCallback(() => scope.getSnapshot(), [scope])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const settings = decodeSettings(snapshot.value) ?? DEFAULT_SETTINGS
  const t = (key: SmContextPianoKey): string => translate(settings.language, key)
  const [error, setError] = useState<SettingsErrorKey | null>(null)
  const [copied, setCopied] = useState(false)
  const dark = useSyncExternalStore(subscribeTheme, hostIsDark, () => false)
  const disabled = !snapshot.writable

  const write = <K extends keyof PianoSettings>(field: K, value: PianoSettings[K]): void => {
    setError(null)
    void scope.set(field, value).catch(() => { setError('settings.writeError') })
  }
  const reset = (): void => {
    setError(null)
    void (async () => {
      try {
        await scope.reset()
      } catch {
        setError('settings.writeError')
      }
    })()
  }
  const copyCommand = (): void => {
    setError(null)
    setCopied(false)
    void (async () => {
      try {
        if (window.navigator.clipboard === undefined) throw new Error('clipboard unavailable')
        await window.navigator.clipboard.writeText(INSTALL_COMMAND)
        setCopied(true)
      } catch {
        setError('settings.copyError')
      }
    })()
  }

  return (
    <div className="smcp-settings-page">
      <style>{SEMANTIC_CSS}</style>
      <section className="smcp-settings-hero">
        <img src={iconUrl} alt="" className="smcp-settings-icon" />
        <span className="smcp-settings-hero-copy">
          <span className="smcp-settings-title">{PROJECT.title}</span>
          <span className="smcp-settings-subtitle">{t('settings.subtitle')}</span>
        </span>
        <label className="smcp-settings-switch">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={disabled}
            onChange={(event) => { write('enabled', event.target.checked) }}
          />
          <span aria-hidden="true" />
          <b>{settings.enabled ? t('settings.enabled') : t('settings.disabled')}</b>
        </label>
      </section>

      {error !== null && <p className="smcp-settings-error smcp-settings-page-error" role="alert">{t(error)}</p>}
      {snapshot.status === 'loading' && <p className="smcp-settings-note" role="status">{t('settings.loading')}</p>}
      {snapshot.status === 'unavailable' && <p className="smcp-settings-note" role="status">{t('settings.unavailable')}</p>}

      <section className="smcp-settings-card"><LayoutPreview settings={settings} /></section>

      <section className="smcp-settings-card smcp-unified" style={paletteStyle(settings) as CSSProperties}>
        <h2>{t('settings.colors')}</h2>
        <p className="smcp-settings-note">{t('settings.colorsDesc')}</p>
        <div className="smcp-color-grid">
          {SEMANTIC_KINDS.map(kind => {
            const field = COLOR_FIELDS[kind]
            return <div className="smcp-color-row" key={kind}>
              <label className="smcp-color-label">
                <span className="smcp-legend-key smcp-bar" data-kind={kind} aria-hidden="true" />
                <span>{kindLabel(kind, settings.language)}<small>{settings[field] || t('settings.themeColor')}</small></span>
                <input type="color" aria-label={kindLabel(kind, settings.language)}
                  value={settings[field] || (kind === 'turn' && dark ? '#ffffff' : THEME_COLORS[dark ? 'dark' : 'light'][kind][0])} disabled={disabled}
                  onChange={event => write(field, event.target.value)} />
              </label>
              <button type="button" className="smcp-color-auto" disabled={disabled || !settings[field]}
                aria-label={`${kindLabel(kind, settings.language)} · ${t('settings.themeColor')}`}
                onClick={() => write(field, '')}>{t('settings.auto')}</button>
            </div>
          })}
        </div>
        <button type="button" className="smcp-settings-reset" disabled={disabled}
          onClick={() => { setError(null); void (async () => { for (const field of Object.keys(DEFAULT_COLORS) as (keyof typeof DEFAULT_COLORS)[]) await scope.unset(field) })().catch(() => setError('settings.writeError')) }}>
          {t('settings.resetColors')}
        </button>
      </section>

      <section className="smcp-settings-card smcp-settings-general">
        <h2>{t('settings.general')}</h2>
        <label className="smcp-settings-row smcp-settings-language">
          <span className="smcp-settings-label">语言/Language</span>
          <select
            className="smcp-settings-select"
            value={settings.language}
            disabled={disabled}
            onChange={(event) => {
              if (isPianoLanguage(event.target.value)) write('language', event.target.value)
            }}
          >
            {LANGUAGE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="smcp-settings-card">
        <h2>{t('settings.appearance')}</h2>
        <RangeRow
          label={t('settings.height')}
          description={t('settings.heightDesc')}
          value={settings.keyHeight}
          min={SETTINGS_LIMITS.keyHeight.min}
          max={SETTINGS_LIMITS.keyHeight.max}
          suffix="px"
          disabled={disabled}
          onChange={(value) => { write('keyHeight', value) }}
        />
        <RangeRow
          label={t('settings.gap')}
          description={t('settings.gapDesc')}
          value={settings.keyGap}
          min={SETTINGS_LIMITS.keyGap.min}
          max={SETTINGS_LIMITS.keyGap.max}
          suffix="px"
          disabled={disabled}
          onChange={(value) => { write('keyGap', value) }}
        />
        <RangeRow
          label={t('settings.maxVisible')}
          description={t('settings.maxVisibleDesc')}
          value={settings.maxVisible}
          min={SETTINGS_LIMITS.maxVisible.min}
          max={SETTINGS_LIMITS.maxVisible.max}
          suffix=""
          disabled={disabled}
          onChange={(value) => { write('maxVisible', value) }}
        />
        <div className="smcp-settings-total">
          <span>{t('settings.totalHeight')}</span>
          <strong>{railHeight(settings)}px</strong>
        </div>
        <button type="button" className="smcp-settings-reset" disabled={disabled} onClick={reset}>
          {t('settings.reset')}
        </button>
      </section>

      <details className="smcp-settings-card smcp-settings-help"><summary>{t('settings.guide')}</summary>
        <p>{t('settings.guideHistory')}</p><p>{t('settings.guideFold')}</p><p>{t('settings.guideKeys')}</p>
      </details>

      <section className="smcp-settings-card smcp-settings-about">
        <h2>{t('settings.about')}</h2>
        <dl>
          <div><dt>{t('settings.version')}</dt><dd>{PROJECT.version}</dd></div>
          <div><dt>{t('settings.releaseDate')}</dt><dd>{PROJECT.releaseDate}</dd></div>
          <div><dt>{t('settings.author')}</dt><dd>{PROJECT.maintainer}</dd></div>
          <div><dt>{t('settings.feedback')}</dt><dd><a href={PROJECT.issuesUrl} target="_blank" rel="noreferrer">GitHub Issues</a></dd></div>
          <div><dt>GitHub</dt><dd><a href={PROJECT.repositoryUrl} target="_blank" rel="noreferrer">{PROJECT.repositoryUrl}</a></dd></div>
          <div><dt>npm</dt><dd><a href={PROJECT.packageUrl} target="_blank" rel="noreferrer">{PROJECT.packageName}</a></dd></div>
        </dl>
      </section>

      <section className="smcp-settings-card smcp-settings-install">
        <h2>{t('settings.install')}</h2>
        <div className="smcp-settings-command-box">
          <code>{INSTALL_COMMAND}</code>
          <button type="button" onClick={copyCommand}>
            {copied ? t('settings.copied') : t('settings.copy')}
          </button>
        </div>
      </section>
    </div>
  )
}
