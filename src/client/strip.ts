/** One visible Piano over the official full-history navigation owner. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { observeChatNodes } from './chat-source.ts'
import { buildNavigationNodesWithQuestions, turnOf } from './keys.ts'
import type { KeyDescriptor } from './keys.ts'
import { buildQuestionKeys } from './question-keys.ts'
import { buildPianoItems, buildPianoItemsForTurn, mergeNavigationTurns } from './navigation-model.ts'
import type { NavigationTurn, PianoItem } from './navigation-model.ts'
import { projectRailSlots, railSlotIndex } from './rail-slots.ts'
import type { RailSlot } from './rail-slots.ts'
import { createNativeNavigation } from './native-navigation.ts'
import { createSemanticLanding } from './semantic-landing.ts'
import { SEMANTIC_CSS, semanticLabel, landingFailure } from './semantic-style.ts'
import type { SmContextPianoKey } from './locales.ts'
import type { PianoSelectedSessionSource } from './session-probe.tsx'
import { COLOR_FIELDS, paletteStyle } from '../core/colors.ts'
import { createPointerWave } from './pointer-wave.ts'
import { DEFAULT_SETTINGS, DEFAULT_SETTINGS_SOURCE, railHeight } from '../core/config.ts'
import type { PianoSettingsSource } from '../core/config.ts'

export function visibleWindow(total: number, center: number, size = DEFAULT_SETTINGS.maxVisible): { start: number; end: number } {
  if (total <= 0 || size <= 0) return { start: 0, end: 0 }
  const count = Math.min(total, size)
  const start = Math.max(0, Math.min(total - count, center - Math.floor(count / 2)))
  return { start, end: start + count }
}
export function stackPositions(count: number, height = railHeight(DEFAULT_SETTINGS), pitch = DEFAULT_SETTINGS.keyGap, markHeight = DEFAULT_SETTINGS.keyHeight): number[] {
  if (count <= 0) return []
  const top = (height - ((count - 1) * pitch + markHeight)) / 2 + markHeight / 2
  return Array.from({ length: count }, (_, index) => top + index * pitch)
}
let instanceCount = 0

const DIRTY_NODES = 1 << 0
const DIRTY_TURNS = 1 << 1
const DIRTY_DOM = 1 << 2
const DIRTY_LAYOUT = 1 << 3
const DIRTY_NATIVE_STATE = 1 << 4
const DIRTY_VIEW = 1 << 5
const DIRTY_KEYED_NODES = 1 << 6
const DIRTY_READER = 1 << 7
const DIRTY_POINTER = 1 << 8
const DIRTY_ALL = DIRTY_NODES | DIRTY_TURNS | DIRTY_DOM | DIRTY_LAYOUT | DIRTY_NATIVE_STATE | DIRTY_VIEW
const STREAM_SEMANTIC_MIN_INTERVAL_MS = 120

/** Attach to the visible ChatView, never to a background/hidden conversation. */
export function attachKeyStrip(ctx: ClientContext, t: Translate<SmContextPianoKey>, selection: PianoSelectedSessionSource, settings: PianoSettingsSource = DEFAULT_SETTINGS_SOURCE): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || document.body === null) return () => {}
  let flow: HTMLElement | undefined
  let stop: (() => void) | undefined
  let disposed = false
  let observer: MutationObserver
  const watchLifecycle = (): void => {
    observer.disconnect()
    if (flow?.isConnected !== true) {
      // No active ChatView: discovery is rare, so a broad watcher is acceptable.
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] })
      return
    }
    // Once mounted, watch only the active flow's ancestor chain. React message
    // body churn is below the flow and must not wake the global lifecycle path.
    observer.observe(flow, { attributes: true, attributeFilter: ['hidden'] })
    let node: HTMLElement | null = flow.parentElement
    while (node !== null) {
      observer.observe(node, { childList: true, attributes: true, attributeFilter: ['hidden'] })
      if (node === document.body) break
      node = node.parentElement
    }
  }
  const reconcile = (): void => {
    if (disposed) return
    const enabled = settings.getSnapshot().enabled
    if (enabled && flow?.isConnected === true && flow.closest('[hidden]') === null) return
    const next = enabled
      ? [...document.querySelectorAll<HTMLElement>('[data-chat-flow]')].find(el => el.closest('[hidden]') === null)
      : undefined
    if (next === flow) { watchLifecycle(); return }
    stop?.()
    stop = undefined
    flow = next
    if (next !== undefined) {
      try { stop = mount(ctx, next, t, selection, settings) }
      catch { console.warn('[dsh-piano-nav] navigator unavailable; native navigation retained') }
    }
    watchLifecycle()
  }
  observer = new MutationObserver(reconcile)
  watchLifecycle()
  const unsubscribe = settings.subscribe(reconcile)
  reconcile()
  return () => { disposed = true; observer.disconnect(); unsubscribe(); stop?.() }
}

function mount(ctx: ClientContext, flow: HTMLElement, t: Translate<SmContextPianoKey>, selection: PianoSelectedSessionSource, settings: PianoSettingsSource): () => void {
  const local = flow.parentElement
  const scrollport = flow.closest<HTMLElement>('[data-conversation-scroll]') ?? local
  const root = scrollport?.parentElement
  if (local === null || scrollport == null || root == null) return () => {}
  const nativeT = ctx.locale.bind('chat')
  const owner = createNativeNavigation(flow, {
    navigation: () => nativeT('chat.turnNavigation.label'),
    jump: (turn, unloaded) => nativeT(unloaded ? 'chat.turnNavigation.jumpLoad' : 'chat.turnNavigation.jump', { turn }),
  })
  // The empty-window hold drives its own rechecks; when one surrenders or
  // recovers outside our render flow, our cached nativeReady/mode is stale.
  owner.onExternalReconcile = () => { schedule(DIRTY_DOM | DIRTY_NATIVE_STATE | DIRTY_VIEW) }
  const landing = createSemanticLanding(flow, owner)
  const prefix = `smcp-${++instanceCount}-`
  const strip = document.createElement('div')
  strip.className = 'smcp-strip smcp-unified'
  strip.tabIndex = 0
  strip.setAttribute('role', 'navigation')
  strip.setAttribute('aria-label', t('nav.aria'))
  strip.hidden = true
  const tooltip = document.createElement('div')
  tooltip.className = 'smcp-tooltip'
  tooltip.id = `${prefix}preview`
  tooltip.setAttribute('role', 'tooltip')
  const badge = document.createElement('span')
  badge.className = 'smcp-key-label'
  const title = document.createElement('div')
  title.className = 'smcp-tooltip-title'
  const body = document.createElement('div')
  body.className = 'smcp-tooltip-body'
  tooltip.append(badge, title, body)
  const status = document.createElement('div')
  status.className = 'smcp-navigation-status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  strip.append(status)
  const style = document.createElement('style')
  style.textContent = '.smcp-unified[hidden]{display:none!important}.smcp-unified .smcp-bar[aria-busy="true"]{opacity:.4}.smcp-navigation-status{position:absolute;left:0;top:100%;width:220px;font-size:12px;line-height:1.4;padding-top:12px;color:var(--dsw-alias-label-secondary,#73757a)}' + SEMANTIC_CSS
  const originalPosition = root.style.position
  const forcedPosition = window.getComputedStyle(root).position === 'static'
  if (forcedPosition) root.style.position = 'relative'
  root.append(strip, tooltip, style)

  let alive = true
  let frame = 0
  let dirty = DIRTY_ALL
  let binding: SessionBinding | undefined
  let sessionLoadingOlder = false
  let sourceStop: (() => void) | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let streamRefresh: ReturnType<typeof setTimeout> | undefined
  let lastStreamSemanticAt = Number.NEGATIVE_INFINITY
  let retries = 0
  let nodes: readonly ChatConversationViewNode[] = []
  let turns: NavigationTurn[] = []
  let segments: KeyDescriptor[] = []
  let questionKeys: ReadonlyMap<string, KeyDescriptor[]> = new Map()
  let nodeByKey = new Map<string, ChatConversationViewNode>()
  let nodeIndexByKey = new Map<string, number>()
  let turnKeys = new Map<number, string[]>()
  let segmentsByTurn = new Map<number, KeyDescriptor[]>()
  let turnByNumber = new Map<number, NavigationTurn>()
  let turnItemRanges = new Map<number, { start: number; count: number }>()
  const keyedDirtyKeys = new Set<string>()
  let items: PianoItem[] = []
  let itemByKey = new Map<string, PianoItem>()
  let itemIndexByKey = new Map<string, number>()
  let firstItemByAnchor = new Map<string, string>()
  let active: string | null = null
  let activeSlotKey: string | null = null
  let selected: string | null = null
  let browseStart: string | null = null
  let windowStart = 0
  let windowSlotStart = 0
  let pointerInside = false
  let pendingPointer: { x: number; y: number } | null = null
  // Fraction of a pitch relative to the selected key, independent of its
  // window index so layout/streaming can preserve the selected preview.
  let pointerOffset: number | null = null
  const pointerWave = createPointerWave()
  const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  let requestedTurn: number | null = null
  let failedTurn: number | null = null
  let localFailure = false
  let activation = 0
  let nativeReady = false
  let gateMisses = 0
  let nativeActiveTurn: number | null = null
  let busyTurn: number | null = null
  let warned = false
  let top = 0
  let left = 0
  let flowLeft = 0
  let width = 0
  let height = 0
  let capacity = 1
  let stripViewportTop = 0
  let stripViewportLeft = 0
  let readingLineY = 0
  let hitTestXs: number[] = []
  let railSlots: RailSlot[] = []
  let visiblePositions: number[] = []
  let visibleSlots: RailSlot[] = []
  const expandedKeys = new Set<string>()
  // Retired disclosures stay folded even if navigation leaves the reading
  // line inside the old process (notably at the scroll-clamped final answer).
  const collapsedKeys = new Set<string>()
  let projectionDirty = true
  let projectedActive: string | null = null
  let projectedProtection = ''
  const clearExpansion = (): void => {
    if (expandedKeys.size === 0) return
    for (const key of expandedKeys) collapsedKeys.add(key)
    expandedKeys.clear(); projectionDirty = true
  }
  let tooltipKey: string | null = null
  let tooltipPosition: string | null = null
  const buttons = new Map<string, HTMLButtonElement>()
  const perf = { renders: 0, readerSkips: 0, nodeRebuilds: 0, keyedSemanticUpdates: 0, itemRebuilds: 0, turnRebuilds: 0, domReconciles: 0, mappedAnchorRebuilds: 0, railProjections: 0, pointerFrames: 0, hitTests: 0, barWrites: 0 }
  const debug = { mounted: true, bars: 0, total: 0, windowStart: 0, sessionId: undefined as string | undefined, hiddenReason: null as string | null, mode: 'native-fallback', nativeReject: null as string | null, nativeSkip: null as string | null, gateMisses: 0, layout: { left: 0, flowLeft: 0, width: 0, top: 0 }, perf }
  const writeData = (button: HTMLButtonElement, name: string, value: string): void => {
    if (button.dataset[name] === value) return
    button.dataset[name] = value
    perf.barWrites++
  }
  const writeAttr = (button: HTMLButtonElement, name: string, value: string): void => {
    if (button.getAttribute(name) === value) return
    button.setAttribute(name, value)
    perf.barWrites++
  }
  const writeStyle = (button: HTMLButtonElement, name: 'top' | 'height' | 'width', value: string): void => {
    if (button.style[name] === value) return
    button.style[name] = value
    perf.barWrites++
  }
  const writeClass = (button: HTMLButtonElement, name: string, enabled: boolean): void => {
    if (button.classList.contains(name) === enabled) return
    button.classList.toggle(name, enabled)
    perf.barWrites++
  }
  const debugHost = globalThis as unknown as { __smcpDebug?: typeof debug }
  debugHost.__smcpDebug = debug

  const copy = (kind: 'turn' | 'loading' | 'failed', turn: number): string => {
    const language = settings.getSnapshot().language
    if (language === 'en') return kind === 'turn' ? `Turn ${turn}` : kind === 'loading'
      ? `Loading turn ${turn}…` : `Turn ${turn} was not loaded. Select it to retry.`
    if (language === 'zh-TW') return kind === 'turn' ? `第 ${turn} 輪` : kind === 'loading'
      ? `正在載入第 ${turn} 輪…` : `第 ${turn} 輪未載入，點擊重試。`
    return kind === 'turn' ? `第 ${turn} 轮` : kind === 'loading'
      ? `正在加载第 ${turn} 轮…` : `第 ${turn} 轮未加载，点击重试。`
  }
  const closePreview = (): void => {
    tooltipKey = null
    tooltipPosition = null
    if (tooltip.classList.contains('smcp-tooltip-visible')) tooltip.classList.remove('smcp-tooltip-visible')
    if (strip.hasAttribute('aria-describedby')) strip.removeAttribute('aria-describedby')
  }
  const collapsedCopy = (count: number): string => {
    const language = settings.getSnapshot().language
    return language === 'en' ? `AI · Process output (${count} segments) · Click to expand`
      : language === 'zh-TW' ? `AI · 過程輸出（${count} 段）· 點擊展開` : `AI · 过程输出（${count} 段）· 点击展开`
  }
  const slotForKey = (key: string | null): RailSlot | undefined => {
    const index = key === null ? -1 : itemIndexByKey.get(key) ?? -1
    return visibleSlots.find(slot => index >= slot.start && index < slot.end)
  }
  const fallback = (reason: string): void => {
    activation++; landing.cancel()
    owner.release()
    strip.hidden = true
    closePreview()
    pendingPointer = null; pointerOffset = null; pointerInside = false
    pointerWave.reset()
    debug.mode = 'native-fallback'
    debug.hiddenReason = reason
    debug.nativeReject = owner.lastReject
    debug.nativeSkip = owner.lastSkip
  }
  const flushRender = (): void => {
    if (!alive) return
    const pending = dirty
    dirty = 0
    try { render(pending) }
    catch {
      fallback('contract')
      if (!warned) { warned = true; console.warn('[dsh-piano-nav] navigator contract changed; native UI restored') }
    }
  }
  const schedule = (flags = DIRTY_VIEW): void => {
    dirty |= flags
    if (!alive || frame !== 0) return
    frame = window.requestAnimationFrame(() => { frame = 0; flushRender() })
  }
  const clearStreamRefresh = (discardDirty = false): void => {
    if (streamRefresh !== undefined) window.clearTimeout(streamRefresh)
    streamRefresh = undefined
    if (discardDirty) keyedDirtyKeys.clear()
  }
  const scheduleKeyedSemantic = (keys: readonly string[]): void => {
    for (const key of keys) keyedDirtyKeys.add(key)
    const now = window.performance.now()
    const wait = STREAM_SEMANTIC_MIN_INTERVAL_MS - (now - lastStreamSemanticAt)
    if (wait <= 0) {
      lastStreamSemanticAt = now
      schedule(DIRTY_KEYED_NODES | DIRTY_VIEW)
      return
    }
    if (streamRefresh !== undefined) return
    streamRefresh = window.setTimeout(() => {
      streamRefresh = undefined
      if (!alive) return
      lastStreamSemanticAt = window.performance.now()
      schedule(DIRTY_KEYED_NODES | DIRTY_VIEW)
    }, wait)
  }
  const readingKey = (): string | null => {
    perf.hitTests++
    const hitTest = document.elementsFromPoint?.bind(document)
    if (typeof hitTest === 'function') {
      for (const x of hitTestXs) {
        for (const element of hitTest(x, readingLineY)) {
          const row = (element as HTMLElement).closest<HTMLElement>('[data-chat-anchor-key]')
          if (row === null || !flow.contains(row) || row.closest('[hidden]') !== null) continue
          const anchor = row.dataset.chatAnchorKey
          if (anchor === undefined) continue
          const key = firstItemByAnchor.get(anchor)
          if (key !== undefined) return key
        }
      }
    }
    const preceding = owner.anchorAtOrBefore(readingLineY)
    if (preceding !== null) {
      const key = firstItemByAnchor.get(preceding)
      if (key !== undefined) return key
    }
    return nativeActiveTurn === null ? null : itemByKey.has(`turn:${nativeActiveTurn}`) ? `turn:${nativeActiveTurn}` : null
  }
  const availableSegment = (segment: KeyDescriptor): KeyDescriptor[] => {
    const visible = owner.rowFor(segment.anchorKey) !== null
    if (!visible && !((segment.kind === 'question' || segment.kind === 'answer' || segment.kind === 'output' || segment.kind === 'final')
      && landing.canReveal(segment.anchorKey))) return []
    // Native process disclosure may change only the DOM, leaving the source
    // node's visibility untouched. The mounted row is the display authority.
    return [segment.kind === 'output' ? { ...segment, folded: !visible } : segment]
  }
  const projectSlots = (): RailSlot[] => {
    const protection = `${busyTurn}:${requestedTurn}:${failedTurn}`
    if (projectionDirty || projectedActive !== active || projectedProtection !== protection) {
      railSlots = projectRailSlots(items, itemIndexByKey.get(active ?? '') ?? -1, expandedKeys,
        new Set([busyTurn, requestedTurn, failedTurn].filter((turn): turn is number => turn !== null)), collapsedKeys)
      projectionDirty = false; projectedActive = active; projectedProtection = protection
      perf.railProjections++
    }
    return railSlots
  }
  const rebuildItemIndex = (): void => {
    projectionDirty = true
    itemByKey = new Map()
    itemIndexByKey = new Map()
    firstItemByAnchor = new Map()
    turnItemRanges = new Map()
    items.forEach((item, index) => {
      itemByKey.set(item.key, item)
      itemIndexByKey.set(item.key, index)
      if (item.anchorKey !== null && !firstItemByAnchor.has(item.anchorKey)) firstItemByAnchor.set(item.anchorKey, item.key)
      const range = turnItemRanges.get(item.turn)
      if (range === undefined) turnItemRanges.set(item.turn, { start: index, count: 1 })
      else range.count++
    })
    owner.setMappedAnchors(firstItemByAnchor.keys())
    for (const key of collapsedKeys) if (!itemByKey.has(key)) collapsedKeys.delete(key)
    perf.mappedAnchorRebuilds++
  }
  const rebuildSemanticState = (): void => {
    keyedDirtyKeys.clear()
    questionKeys = buildQuestionKeys(nodes, turnOf)
    segments = buildNavigationNodesWithQuestions(nodes, questionKeys)
    nodeByKey = new Map()
    nodeIndexByKey = new Map()
    turnKeys = new Map()
    nodes.forEach((node, index) => {
      nodeByKey.set(node.key, node)
      nodeIndexByKey.set(node.key, index)
      const turn = turnOf(node)
      if (turn === null) return
      const keys = turnKeys.get(turn) ?? []
      keys.push(node.key)
      turnKeys.set(turn, keys)
    })
    segmentsByTurn = new Map()
    for (const segment of segments) {
      if (segment.turn === null) continue
      const list = segmentsByTurn.get(segment.turn) ?? []
      list.push(segment)
      segmentsByTurn.set(segment.turn, list)
    }
    perf.nodeRebuilds++
  }
  const rebuildItemsFromSegments = (): void => {
    segments = [...segmentsByTurn.values()].flat()
    const availableSegments = segments.flatMap(availableSegment)
    items = buildPianoItems(turns, availableSegments, turn => copy('turn', turn))
    rebuildItemIndex()
    perf.itemRebuilds++
    debug.total = items.length
  }
  const replaceTurnItems = (turn: number, nextItems: PianoItem[]): boolean => {
    const range = turnItemRanges.get(turn)
    if (range === undefined || range.count !== nextItems.length) return false
    const previous = items.slice(range.start, range.start + range.count)
    if (previous.some((item, index) => item.key !== nextItems[index]?.key)) return false
    projectionDirty = true
    const anchorsStable = previous.every((item, index) => item.anchorKey === nextItems[index]?.anchorKey)
    if (!anchorsStable) {
      const oldKeys = new Set(previous.map(item => item.key))
      for (const item of previous) {
        if (item.anchorKey !== null && oldKeys.has(firstItemByAnchor.get(item.anchorKey) ?? '')) firstItemByAnchor.delete(item.anchorKey)
      }
    }
    nextItems.forEach((item, offset) => {
      const index = range.start + offset
      items[index] = item
      itemByKey.set(item.key, item)
      itemIndexByKey.set(item.key, index)
      if (!anchorsStable && item.anchorKey !== null && !firstItemByAnchor.has(item.anchorKey)) firstItemByAnchor.set(item.anchorKey, item.key)
    })
    // Streaming text normally changes only preview/title. Avoid re-filtering every
    // transcript row when the stable Piano key -> DOM anchor mapping is unchanged.
    if (!anchorsStable) {
      owner.setMappedAnchors(firstItemByAnchor.keys())
      perf.mappedAnchorRebuilds++
    }
    return true
  }
  const refreshKeyedSemantic = (): void => {
    const dirtyKeys = [...keyedDirtyKeys]
    keyedDirtyKeys.clear()
    if (dirtyKeys.length === 0) return
    const dirtyTurns = new Set<number>()
    let requiresFullSemantic = false
    for (const key of dirtyKeys) {
      const index = nodeIndexByKey.get(key)
      const previous = nodeByKey.get(key)
      const next = index === undefined ? undefined : nodes[index]
      if (previous === undefined || next === undefined || next.key !== key || previous.kind !== next.kind
        || previous.kind === 'tool-call' || next.kind === 'tool-call') {
        requiresFullSemantic = true
        break
      }
      const oldTurn = turnOf(previous)
      const nextTurn = turnOf(next)
      if (oldTurn !== nextTurn || nextTurn === null) {
        requiresFullSemantic = true
        break
      }
      nodeByKey.set(key, next)
      dirtyTurns.add(nextTurn)
    }
    if (requiresFullSemantic) {
      rebuildSemanticState()
      rebuildItemsFromSegments()
      return
    }
    let rebuildAllItems = false
    for (const turn of dirtyTurns) {
      const keys = turnKeys.get(turn)
      const navigationTurn = turnByNumber.get(turn)
      if (keys === undefined || navigationTurn === undefined) {
        rebuildAllItems = true
        continue
      }
      const turnNodes = keys.flatMap(key => {
        const node = nodeByKey.get(key)
        return node === undefined ? [] : [node]
      })
      const nextSegments = buildNavigationNodesWithQuestions(turnNodes, questionKeys)
      segmentsByTurn.set(turn, nextSegments)
      const nextItems = buildPianoItemsForTurn(navigationTurn, nextSegments.flatMap(availableSegment), value => copy('turn', value))
      if (!replaceTurnItems(turn, nextItems)) rebuildAllItems = true
      perf.keyedSemanticUpdates++
    }
    if (rebuildAllItems) rebuildItemsFromSegments()
    else debug.total = items.length
  }
  const measureLayout = (): void => {
    const rootRect = root.getBoundingClientRect()
    const flowRect = flow.getBoundingClientRect()
    const scrollRect = scrollport.getBoundingClientRect()
    flowLeft = flowRect.left - rootRect.left
    width = root.clientWidth || rootRect.width
    left = Math.max(16, flowLeft - 108)
    const config = settings.getSnapshot()
    const available = Math.max(0, scrollport.clientHeight - (composerSeat?.offsetHeight ?? 0))
    height = Math.min(railHeight(config), Math.max(config.keyHeight, available - 48))
    capacity = Math.min(config.maxVisible, Math.max(1, Math.floor((height - config.keyHeight) / config.keyGap) + 1))
    top = Math.max(8, (scrollRect.top - rootRect.top) + (available - height) / 2)
    stripViewportTop = rootRect.top + top
    stripViewportLeft = rootRect.left + left
    readingLineY = scrollRect.top + Math.min(120, scrollport.clientHeight * .18)
    hitTestXs = flowRect.width > 0
      ? [flowRect.left + flowRect.width / 2, Math.min(flowRect.right - 1, flowRect.left + 18)]
      : []
    debug.layout.left = left; debug.layout.flowLeft = flowLeft; debug.layout.width = width; debug.layout.top = top
  }
  const renderFeedback = (pending: number): void => {
    const config = settings.getSnapshot()
    const focusedSlot = slotForKey(selected)
    const focusIndex = focusedSlot?.displayIndex ?? -1
    const focused = selected === null || focusedSlot === undefined ? undefined : itemByKey.get(selected)
    if (focused !== undefined && focusedSlot !== undefined) {
      const collapsed = focusedSlot.end - focusedSlot.start > 1
      const previewIdentity = `${focused.key}:${collapsed ? focusedSlot.end - focusedSlot.start : 1}:${config.language}`
      const previewChanged = tooltipKey !== previewIdentity
      const contentChanged = previewChanged || (pending & (DIRTY_NODES | DIRTY_KEYED_NODES | DIRTY_TURNS)) !== 0
      if (contentChanged) {
        tooltipKey = previewIdentity
        badge.textContent = collapsed ? collapsedCopy(focusedSlot.end - focusedSlot.start) : semanticLabel(focused, config.language)
        title.textContent = collapsed ? copy('turn', focused.turn) : focused.title
        body.textContent = collapsed ? '' : focused.preview
      }
      const nextTooltipPosition = `${left}:${width}:${top}:${visiblePositions[focusIndex]}`
      if (contentChanged || (pending & DIRTY_LAYOUT) !== 0 || tooltipPosition !== nextTooltipPosition) {
        tooltipPosition = nextTooltipPosition
        const previewWidth = tooltip.offsetWidth || 400
        const previewHeight = tooltip.offsetHeight || 150
        const rootHeight = root.clientHeight
        tooltip.style.left = `${Math.max(8, Math.min(left + 64, width - previewWidth - 8))}px`
        tooltip.style.top = `${Math.max(8, Math.min(top + visiblePositions[focusIndex] - 48, rootHeight - previewHeight - 8))}px`
      }
      if (!tooltip.classList.contains('smcp-tooltip-visible')) tooltip.classList.add('smcp-tooltip-visible')
      const focusedId = buttons.get(focusedSlot.item.key)!.id
      if (strip.getAttribute('aria-activedescendant') !== focusedId) strip.setAttribute('aria-activedescendant', focusedId)
      if (strip.getAttribute('aria-describedby') !== tooltip.id) strip.setAttribute('aria-describedby', tooltip.id)
    } else {
      closePreview()
      if (strip.hasAttribute('aria-activedescendant')) strip.removeAttribute('aria-activedescendant')
    }
    // Only amplitude eases on entry/exit. Y continues to follow the latest
    // sample directly; retirement has no semantic selection or click lease.
    const wave = pointerWave.sample(window.performance.now(), motionPreference?.matches)
    const waveSlot = slotForKey(wave.anchor?.key ?? null)
    if (wave.anchor !== null && waveSlot === undefined) pointerWave.reset()
    const followingPointer = focusIndex >= 0 && pointerOffset !== null
    if (strip.classList.contains('smcp-pointer-follow') !== followingPointer) strip.classList.toggle('smcp-pointer-follow', followingPointer)
    // Also suppress CSS chasing on the final fade frame. The next non-pointer
    // render restores normal keyboard/reader transitions from the settled width.
    strip.classList.toggle('smcp-pointer-frame', pending === DIRTY_POINTER || wave.moving)
    const waveCenter = followingPointer ? focusIndex + pointerOffset!
      : focusedSlot !== undefined ? focusIndex
      : waveSlot === undefined ? null : waveSlot.displayIndex + (wave.anchor?.offset ?? 0)
    const strength = followingPointer || focusedSlot === undefined ? wave.strength : 1
    visibleSlots.forEach(slot => {
      const button = buttons.get(slot.item.key)
      if (button === undefined) return
      writeClass(button, 'smcp-bar-hover', slot === focusedSlot)
      writeStyle(button, 'width', `${barWidth(slot.item, slot.displayIndex, waveCenter, strength)}px`)
    })
    if (wave.moving && waveSlot !== undefined) schedule(DIRTY_POINTER)
  }
  const render = (pending: number): void => {
    perf.renders++
    if (pending === DIRTY_POINTER) {
      if (!nativeReady || strip.hidden) { pendingPointer = null; return }
      applyPointer()
      renderFeedback(pending)
      perf.pointerFrames++
      return
    }
    if ((pending & DIRTY_TURNS) !== 0) {
      const snapshot = binding === undefined ? undefined : ctx.uiConversation.binding(binding).target('chat').getSnapshot()
      const loaded = snapshot?.navigation.items() ?? []
      const outline = binding?.session.projections.faceOf('turnOutline').getSnapshot()
      turns = mergeNavigationTurns(loaded, outline)
      turnByNumber = new Map(turns.map(turn => [turn.turn, turn]))
      perf.turnRebuilds++
    }
    if ((pending & DIRTY_NODES) !== 0) rebuildSemanticState()
    else if ((pending & DIRTY_KEYED_NODES) !== 0) refreshKeyedSemantic()
    if ((pending & (DIRTY_DOM | DIRTY_TURNS)) !== 0) {
      nativeReady = owner.reconcile(turns)
      if ((pending & DIRTY_DOM) !== 0) landing.refresh()
      perf.domReconciles++
    }
    if ((pending & (DIRTY_NODES | DIRTY_TURNS | DIRTY_DOM)) !== 0) rebuildItemsFromSegments()
    if ((pending & (DIRTY_NATIVE_STATE | DIRTY_DOM | DIRTY_TURNS)) !== 0) {
      busyTurn = owner.busy()
      nativeActiveTurn = owner.active()
    }
    if ((pending & DIRTY_LAYOUT) !== 0 || width === 0) measureLayout()
    const gateFails = (): boolean => !nativeReady || items.length === 0 || width < 520 || left + 70 > flowLeft
    if (gateFails()) {
      // Layout-only failures while taken over can ride on stale numbers
      // (claim/release repaints land mid-frame; mount-time measurements may
      // predate the first flow layout). Re-measure once — a stale-number
      // failure clears immediately. If the fresh measurement still fails,
      // tolerate up to 3 consecutive misses, scheduling a follow-up frame per
      // miss (ResizeObserver fires once per real change; without a re-schedule
      // the threshold would never be reached) before handing the UI back.
      // Ownership failures (!nativeReady — reconcile already released the
      // native surface) and empty items always fall back immediately:
      // hysteresis is for geometry only.
      let recovered = false
      if (debug.mode === 'piano' && nativeReady && items.length !== 0) {
        measureLayout()
        if (!gateFails()) recovered = true
        else if (++gateMisses < 3) { debug.gateMisses = gateMisses; schedule(DIRTY_LAYOUT); return }
      }
      if (!recovered) {
        gateMisses = 0; debug.gateMisses = 0
        fallback(!nativeReady ? 'contract' : items.length === 0 ? 'empty' : width < 520 ? 'narrow' : 'overlap')
        return
      }
    }
    gateMisses = 0; debug.gateMisses = 0
    const readerOnly = (pending & DIRTY_READER) !== 0 && (pending & ~DIRTY_READER) === 0
    if (readerOnly) {
      const nextActive = readingKey() ?? `turn:${nativeActiveTurn ?? turns.at(-1)?.turn}`
      if (nextActive === active) {
        perf.readerSkips++
        return
      }
      active = nextActive
    }
    const config = settings.getSnapshot()
    const loadedBusy = sessionLoadingOlder
    if (requestedTurn !== null && busyTurn === null && !loadedBusy) {
      const destination = turns.find(turn => turn.turn === requestedTurn)
      failedTurn = destination?.anchor.kind === 'unloaded' ? requestedTurn : null
      requestedTurn = null
    }
    if (!readerOnly) active = readingKey() ?? `turn:${nativeActiveTurn ?? turns.at(-1)?.turn}`
    if (selected !== null && !itemByKey.has(selected)) selected = null
    const centerKey = selected !== null && (document.activeElement === strip || pointerInside || busyTurn !== null) ? selected : active
    const center = Math.max(0, centerKey === null ? 0 : itemIndexByKey.get(centerKey) ?? 0)
    for (const key of expandedKeys) if (!itemByKey.has(key)) { expandedKeys.delete(key); projectionDirty = true }
    railSlots = projectSlots()
    const manual = railSlotIndex(railSlots, browseStart === null ? -1 : itemIndexByKey.get(browseStart) ?? -1)
    windowSlotStart = manual < 0 ? visibleWindow(railSlots.length, railSlotIndex(railSlots, center), capacity).start
      : Math.max(0, Math.min(railSlots.length - capacity, manual))
    visibleSlots = railSlots.slice(windowSlotStart, windowSlotStart + capacity).map((slot, displayIndex) => ({ ...slot, displayIndex }))
    activeSlotKey = slotForKey(active)?.item.key ?? null
    windowStart = visibleSlots[0]?.start ?? 0
    const stripTop = `${top}px`
    const stripLeft = `${left}px`
    const stripHeight = `${height}px`
    if (strip.style.top !== stripTop) strip.style.top = stripTop
    if (strip.style.transform !== 'none') strip.style.transform = 'none'
    if (strip.style.left !== stripLeft) strip.style.left = stripLeft
    if (strip.style.height !== stripHeight) strip.style.height = stripHeight
    visiblePositions = stackPositions(visibleSlots.length, height, config.keyGap, config.keyHeight)
    const retained = new Set(visibleSlots.map(slot => slot.item.key))
    for (const [key, button] of buttons) if (!retained.has(key)) { button.remove(); buttons.delete(key) }
    applyPointer()
    visibleSlots.forEach(slot => {
      const { item, displayIndex: index } = slot
      const collapsed = slot.end - slot.start > 1
      let button = buttons.get(item.key)
      if (button === undefined) {
        button = document.createElement('button')
        button.type = 'button'; button.tabIndex = -1; button.className = 'smcp-bar'
        button.dataset.key = item.key
        button.id = prefix + encodeURIComponent(item.key)
        buttons.set(item.key, button); strip.append(button)
      }
      writeData(button, 'turn', String(item.turn))
      writeData(button, 'role', item.role)
      writeData(button, 'kind', collapsed ? 'output' : item.kind ?? 'turn')
      writeData(button, 'collapsed', String(collapsed))
      writeData(button, 'count', String(slot.end - slot.start))
      writeData(button, 'unloaded', String(!collapsed && item.anchorKey === null))
      // A turn that needs the official load action but whose button is
      // currently virtualized out of the native window cannot be activated;
      // direct button activation is disabled; geometry clicks and keyboard
      // still retire disclosure in activate() without attempting navigation.
      const navBlocked = !collapsed && item.anchorKey === null && !owner.hasButton(item.turn)
      if (navBlocked !== button.hasAttribute('disabled')) {
        if (navBlocked) button.setAttribute('disabled', '')
        else button.removeAttribute('disabled')
        perf.barWrites++
      }
      writeAttr(button, 'aria-label', collapsed ? collapsedCopy(slot.end - slot.start) : `${copy('turn', item.turn)} · ${semanticLabel(item, config.language)}: ${item.title}`)
      if (collapsed) writeAttr(button, 'aria-expanded', 'false')
      else if (button.hasAttribute('aria-expanded')) { button.removeAttribute('aria-expanded'); perf.barWrites++ }
      writeAttr(button, 'aria-current', String(item.key === activeSlotKey))
      writeAttr(button, 'aria-busy', String(item.turn === busyTurn))
      writeClass(button, 'smcp-bar-current', item.key === activeSlotKey)
      writeStyle(button, 'top', `${visiblePositions[index] - config.keyHeight / 2}px`)
      writeStyle(button, 'height', `${config.keyHeight}px`)
    })
    renderFeedback(pending)
    status.textContent = localFailure ? landingFailure(config.language)
      : busyTurn !== null ? copy('loading', busyTurn) : failedTurn !== null ? copy('failed', failedTurn) : ''
    strip.hidden = false; owner.claim()
    debug.mode = 'piano'; debug.hiddenReason = null; debug.nativeReject = null; debug.nativeSkip = owner.lastSkip; debug.bars = visibleSlots.length; debug.windowStart = windowStart
  }
  const bind = (): void => {
    const id = selection.getSnapshot()
    const next = id === undefined ? undefined : ctx.sessions.binding(id)
    if (next === binding && sourceStop !== undefined) return
    sourceStop?.(); sourceStop = undefined
    clearStreamRefresh(true)
    // Retire any native delayed landing while the old binding still owns the
    // real TurnNavigator. Relying on the outgoing ChatView to unmount first is
    // timing-sensitive when sessions switch during an in-flight history load.
    owner.cancel()
    fallback('binding')
    binding = next; nodes = []; selected = active = browseStart = null
    clearExpansion()
    collapsedKeys.clear(); projectionDirty = true
    sessionLoadingOlder = next?.session.getSnapshot().loadingOlder ?? false
    requestedTurn = failedTurn = null; localFailure = false
    debug.sessionId = id === undefined ? undefined : String(id)
    if (retry !== undefined) clearTimeout(retry)
    retry = undefined
    if (next === undefined) {
      turns = []; segments = []; items = []
      questionKeys = new Map(); nodeByKey.clear(); nodeIndexByKey.clear(); turnKeys.clear(); segmentsByTurn.clear(); turnByNumber.clear(); turnItemRanges.clear()
      itemByKey.clear(); itemIndexByKey.clear(); firstItemByAnchor.clear()
      for (const button of buttons.values()) button.remove()
      buttons.clear()
      if (id !== undefined && retries++ < 20) retry = setTimeout(() => { retry = undefined; bind() }, 300)
      schedule(DIRTY_ALL); return
    }
    retries = 0
    const target = ctx.uiConversation.binding(next).target('chat')
    const stops: (() => void)[] = []
    try {
      stops.push(observeChatNodes(target, (value, change, dirtyKeys) => {
        if (!alive || binding !== next) return
        nodes = value
        if (change === 'keyed') {
          scheduleKeyedSemantic(dirtyKeys ?? [])
          return
        }
        clearStreamRefresh(true)
        lastStreamSemanticAt = window.performance.now()
        schedule(DIRTY_NODES | DIRTY_TURNS | DIRTY_DOM | DIRTY_LAYOUT | DIRTY_NATIVE_STATE | DIRTY_VIEW)
      }))
      stops.push(next.session.projections.faceOf('turnOutline').subscribe(() => schedule(DIRTY_TURNS | DIRTY_NATIVE_STATE | DIRTY_VIEW)))
      sessionLoadingOlder = next.session.getSnapshot().loadingOlder ?? false
      stops.push(next.session.subscribe(() => {
        const nextLoadingOlder = next.session.getSnapshot().loadingOlder ?? false
        if (nextLoadingOlder === sessionLoadingOlder) return
        sessionLoadingOlder = nextLoadingOlder
        schedule(DIRTY_NATIVE_STATE | DIRTY_VIEW)
      }))
      sourceStop = () => { for (const dispose of stops) dispose() }
    } catch (error) {
      for (const dispose of stops.reverse()) dispose()
      throw error
    }
    schedule(DIRTY_ALL)
  }
  const activate = (item: PianoItem | undefined): void => {
    if (item === undefined || !nativeReady || strip.hidden) return
    // A disclosed group is a navigation list: moving between its members
    // must preserve it. Other semantic/history keys still retire the group.
    if (!expandedKeys.has(item.key)) clearExpansion()
    // An unloaded turn whose official load button is virtualized out has no
    // runnable action this frame (no button to click, no row to scroll to).
    // Retire disclosure even when the strip's geometry click or keyboard
    // reaches a disabled key, but never attempt an unavailable native action.
    // Reconcile re-enables navigation once the official button returns.
    if (item.anchorKey === null && !owner.hasButton(item.turn)) { schedule(DIRTY_VIEW); return }
    const ticket = ++activation
    failedTurn = null; localFailure = false
    requestedTurn = item.anchorKey === null ? item.turn : null
    selected = item.key; active = item.key; browseStart = null
    strip.focus({ preventScroll: true })
    void landing.navigate(item).then(ok => {
      if (!alive || ticket !== activation || ok === undefined) return
      if (!ok) { requestedTurn = null; localFailure = true }
      schedule()
    })
    schedule()
  }
  // Hover and clicks follow the visible key, including its expanded portion.
  // Neither path accepts the unused 58px container or an unpainted target.
  const BAR_HIT_TOLERANCE = 3
  const baseWidth = (item: PianoItem): number => item.key === activeSlotKey ? 24 : 10
  const barWidth = (item: PianoItem, index: number, focusIndex: number | null, strength = 1): number => {
    const base = baseWidth(item)
    const wave = focusIndex === null ? 0 : Math.exp(-((index - focusIndex) ** 2) / (2 * 1.35 ** 2))
    // A newly current key may still be painting between 10px and its 24px
    // base. A signed acquisition preserves it without inverting other keys.
    return Math.max(10, base + (48 - base) * wave * strength)
  }
  const nearestIndex = (clientY: number): number => {
    if (visibleSlots.length === 0) return -1
    let best = 0
    const y = clientY - stripViewportTop
    for (let i = 1; i < visibleSlots.length; i++) {
      if (Math.abs(visiblePositions[i] - y) < Math.abs(visiblePositions[best] - y)) best = i
    }
    return best
  }
  const keyHitAt = (clientX: number, clientY: number): { index: number; painted: number } | null => {
    const index = nearestIndex(clientY)
    if (index < 0) return null
    const slot = visibleSlots[index]
    if (slot === undefined) return null
    // Hidden members must not leave a tall invisible click/hover region.
    if (Math.abs(clientY - stripViewportTop - visiblePositions[index]) > settings.getSnapshot().keyGap / 2) return null
    const item = slot.item
    // Geometry is read once per pointer frame. A keyboard transition or finite
    // pointer envelope can be between widths: targets never authorize clicks.
    const button = buttons.get(item.key)
    const painted = button === undefined
      ? baseWidth(item)
      : button.getBoundingClientRect().width
    const x = clientX - stripViewportLeft
    return x >= -BAR_HIT_TOLERANCE && x <= painted + BAR_HIT_TOLERANCE ? { index, painted } : null
  }
  const applyPointer = (): void => {
    const sample = pendingPointer
    pendingPointer = null
    if (sample === null) return
    const hit = keyHitAt(sample.x, sample.y)
    const slot = hit === null ? undefined : visibleSlots[hit.index]
    pointerInside = true
    browseStart ??= items[windowStart]?.key ?? null
    selected = slot?.item.key ?? null
    pointerOffset = hit === null ? null
      : (sample.y - stripViewportTop - visiblePositions[hit.index]) / settings.getSnapshot().keyGap
    const peak = slot === undefined ? 0 : barWidth(slot.item, slot.displayIndex, slot.displayIndex + pointerOffset!) - baseWidth(slot.item)
    const paintedStrength = hit === null || slot === undefined || peak === 0 ? 0 : (hit.painted - baseWidth(slot.item)) / peak
    const now = window.performance.now(), reducedMotion = motionPreference?.matches
    pointerWave.point(slot === undefined ? null : { key: slot.item.key, offset: pointerOffset! }, now, reducedMotion, paintedStrength)
    if (slot !== undefined) {
      // A new Y offset can narrow this frame's key. Revalidate the resulting
      // paint without a second DOM read, even if no later pointer event arrives.
      const nextWidth = barWidth(slot.item, slot.displayIndex, slot.displayIndex + pointerOffset!, pointerWave.sample(now, reducedMotion).strength)
      if (sample.x - stripViewportLeft > nextWidth + BAR_HIT_TOLERANCE) {
        selected = null; pointerOffset = null
        pointerWave.point(null, now, reducedMotion)
      }
    }
  }
  const clearPointer = (): void => { pendingPointer = null; pointerOffset = null; pointerWave.reset() }
  const pointerMove = (event: PointerEvent): void => {
    // Read painted geometry once for the latest sample in the next frame,
    // rather than once for every raw high-frequency pointer event.
    pendingPointer = { x: event.clientX, y: event.clientY }
    schedule(DIRTY_POINTER)
  }
  const retireExpansion = (): void => { clearExpansion(); selected = null; browseStart = null; schedule(DIRTY_VIEW) }
  const releaseHover = (): void => {
    selected = null
    if (expandedKeys.size === 0) browseStart = null
    // Leaving an unexpanded rail also releases manual browsing and recenters
    // its window on the reader; this requires the normal projection/window path.
    schedule(DIRTY_VIEW)
  }
  const clearHover = (): void => { clearPointer(); releaseHover() }
  const pointerLeave = (): void => {
    pendingPointer = null; pointerOffset = null; pointerInside = false
    pointerWave.point(null, window.performance.now(), motionPreference?.matches)
    releaseHover()
  }
  const engage = (key: string | null): void => {
    // Home/End followed by Enter, or a second activation after disclosure,
    // can arrive before rAF. Apply the queued projection before resolving it.
    if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0; flushRender() }
    if (!nativeReady || strip.hidden) return
    const slot = slotForKey(key)
    if (slot === undefined) return
    clearPointer()
    if (slot.end - slot.start > 1) {
      clearExpansion()
      for (let index = slot.start; index < slot.end; index++) {
        const member = items[index].key
        collapsedKeys.delete(member); expandedKeys.add(member)
      }
      projectionDirty = true
      selected = slot.end - slot.start > capacity ? items[slot.start].key : key
      const nextSlots = projectSlots()
      const runStart = railSlotIndex(nextSlots, slot.start)
      const count = Math.min(capacity, slot.end - slot.start)
      const start = Math.max(0, Math.min(nextSlots.length - capacity, runStart - Math.floor((capacity - count) / 2)))
      browseStart = nextSlots[start]?.item.key ?? null
      strip.focus({ preventScroll: true })
      schedule(DIRTY_VIEW)
      return
    }
    activate(itemByKey.get(key ?? ''))
  }
  const click = (event: MouseEvent): void => {
    // A click can arrive before the queued pointer/layout frame. Resolve
    // geometry only after that frame, just as engage resolves slot identity.
    if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0; flushRender() }
    const key = (event.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key
    if (key !== undefined) { engage(key); return }
    const hit = keyHitAt(event.clientX, event.clientY)
    if (hit !== null) engage(visibleSlots[hit.index].item.key)
  }
  const wheel = (event: WheelEvent): void => {
    if (event.deltaY === 0 || items.length === 0) return
    event.preventDefault()
    clearPointer()
    clearExpansion()
    const first = items[windowStart]?.key
    const nextSlots = projectSlots()
    const current = railSlotIndex(nextSlots, itemIndexByKey.get(first ?? '') ?? -1)
    const index = Math.max(0, Math.min(nextSlots.length - capacity, current + Math.sign(event.deltaY) * 3))
    browseStart = nextSlots[index]?.item.key ?? null; selected = null; schedule(DIRTY_VIEW)
  }
  const cancelLocal = (): void => {
    activation++; landing.cancel()
    requestedTurn = failedTurn = null; localFailure = false; schedule(DIRTY_NATIVE_STATE | DIRTY_VIEW)
  }
  const cancel = (): void => { cancelLocal(); owner.cancel() }
  const keydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { clearPointer(); event.preventDefault(); cancel(); retireExpansion(); return }
    if (event.key === 'Enter' || event.key === ' ') {
      clearPointer(); event.preventDefault(); engage(selected ?? active ?? items[windowStart]?.key ?? null); return
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return
    event.preventDefault()
    clearPointer()
    const index = Math.max(0, itemIndexByKey.get(selected ?? active ?? '') ?? 0)
    const page = Math.max(1, visibleSlots.length)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : event.key === 'PageUp' ? -page : page)))
    selected = items[next]?.key ?? null
    const slot = railSlotIndex(railSlots, next)
    browseStart = railSlots[visibleWindow(railSlots.length, slot, page).start]?.item.key ?? null
    schedule(DIRTY_VIEW)
  }
  const readerKey = (event: KeyboardEvent): void => {
    if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]') !== null) return
    if (['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', ' '].includes(event.key)) cancel()
  }
  const readerPointer = (event: Event): void => {
    // NativeNavigation already handles pointerdown once, including touch.
    // This listener only retires the short local disclosure transaction.
    if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]') === null) cancelLocal()
  }
  const onScroll = (): void => { schedule(DIRTY_READER) }
  let composerSeat = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  let resize: ResizeObserver | null = null
  const touchesAnchor = (node: Node): boolean => node instanceof window.Element
    && (node.matches('[data-chat-anchor-key]') || node.querySelector('[data-chat-anchor-key]') !== null)
  const touchesNavigation = (node: Node): boolean => node instanceof window.Element
    && (node.matches('nav,[role="navigation"]') || node.querySelector('nav,[role="navigation"]') !== null)
  const touchesComposer = (node: Node): boolean => node instanceof window.Element
    && (node.matches('[data-composer-seat]') || node.querySelector('[data-composer-seat]') !== null)
  let composerParent: HTMLElement | null = composerSeat?.parentElement ?? null
  let composerDom: MutationObserver | null = null
  const observeComposerParent = (): void => {
    composerDom?.disconnect()
    if (composerDom === null) return
    composerDom.observe(scrollport, { childList: true })
    if (composerParent !== null && composerParent !== scrollport) composerDom.observe(composerParent, { childList: true })
  }
  const syncComposerSeat = (): void => {
    const next = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
    const nextParent = next?.parentElement ?? null
    if (next === composerSeat && nextParent === composerParent) return
    if (composerSeat !== null) resize?.unobserve(composerSeat)
    composerSeat = next
    composerParent = nextParent
    if (composerSeat !== null) resize?.observe(composerSeat)
    observeComposerParent()
  }
  const childListChangesNavigation = (record: MutationRecord): boolean => {
    const target = record.target instanceof window.Element ? record.target : record.target.parentElement
    const outsideFlow = target === null || !flow.contains(target)
    if (outsideFlow && target?.closest('nav,[role="navigation"]') !== null) return true
    if (outsideFlow) {
      for (const node of record.addedNodes) if (touchesNavigation(node)) return true
      for (const node of record.removedNodes) if (touchesNavigation(node)) return true
    }
    for (const node of record.addedNodes) if (touchesAnchor(node)) return true
    for (const node of record.removedNodes) if (touchesAnchor(node)) return true
    return false
  }
  let nativeSurface: HTMLElement | null = null
  let nativeSurfaceParent: HTMLElement | null = null
  // Same scope contract as native-navigation reconcile: DSH 0.1.7 mounts the
  // TurnNavigator at the [data-conversation-scroll] level, outside
  // flow.parentElement. Surface discovery, structure and attribute observation
  // must cover that scope too, or a claimed navigator silently stops syncing.
  const nativeScope = scrollport ?? local
  // Rebind first: when the observed slot swaps in a new nav, keep watching the
  // live surface instead of the detached one.
  const nativeStructureDom = new MutationObserver(() => {
    syncNativeSurfaceObserver()
    schedule(DIRTY_DOM | DIRTY_VIEW)
  })
  const syncNativeSurfaceObserver = (): void => {
    const next = [...nativeScope.querySelectorAll<HTMLElement>('nav,[role="navigation"]')]
      .find(element => !flow.contains(element) && element.getAttribute('aria-label') === nativeT('chat.turnNavigation.label')) ?? null
    const nextParent = next?.parentElement ?? null
    // The same nav can be re-slotted under a new wrapper; its parent must be
    // observed too, or a later in-slot replacement goes unseen.
    if (next === nativeSurface && nextParent === nativeSurfaceParent) return
    nativeStructureDom.disconnect()
    nativeSurface = next
    nativeSurfaceParent = nextParent
    if (nativeSurface !== null) {
      nativeStructureDom.observe(nativeSurface, { childList: true, subtree: true })
      if (nextParent !== null && nextParent !== nativeScope) nativeStructureDom.observe(nextParent, { childList: true })
    }
  }
  const structureDom = new MutationObserver(records => {
    if (!records.some(childListChangesNavigation)) return
    syncNativeSurfaceObserver()
    schedule(DIRTY_DOM | DIRTY_VIEW)
  })
  // Official ChatView renders ChatNodeSeat wrappers as direct children of
  // [data-chat-flow]. Watching only that structural boundary avoids every
  // Markdown/token childList mutation inside a message body.
  structureDom.observe(flow, { childList: true })
  structureDom.observe(nativeScope, { childList: true })
  syncNativeSurfaceObserver()
  const attributeDom = new MutationObserver(records => {
    let flags = 0
    for (const record of records) {
      const target = record.target instanceof window.Element ? record.target : null
      if (record.attributeName === 'hidden') {
        if (target === null || !flow.contains(target) || target.matches('[data-chat-anchor-key]')) flags |= DIRTY_DOM | DIRTY_VIEW
        continue
      }
      // Native contract attributes live outside the transcript flow. Ignore
      // matching aria attributes inside rich message content.
      if (target !== null && flow.contains(target)) continue
      if (record.attributeName === 'aria-label' || record.attributeName === 'disabled') flags |= DIRTY_DOM | DIRTY_VIEW
      else if (record.attributeName === 'aria-current' || record.attributeName === 'aria-busy') flags |= DIRTY_NATIVE_STATE | DIRTY_VIEW
    }
    if (flags !== 0) schedule(flags)
  })
  attributeDom.observe(nativeScope, { subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-label', 'aria-current', 'aria-busy', 'disabled'] })
  composerDom = new MutationObserver(records => {
    if (!records.some(record => [...record.addedNodes, ...record.removedNodes].some(touchesComposer))) return
    syncComposerSeat()
    schedule(DIRTY_LAYOUT | DIRTY_VIEW)
  })
  observeComposerParent()
  resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule(DIRTY_LAYOUT | DIRTY_VIEW))
  resize?.observe(root); resize?.observe(flow); resize?.observe(scrollport)
  if (composerSeat !== null) resize?.observe(composerSeat)
  strip.addEventListener('pointermove', pointerMove); strip.addEventListener('pointerleave', pointerLeave)
  strip.addEventListener('blur', clearHover)
  const motionChanged = (): void => { schedule(DIRTY_POINTER) }
  motionPreference?.addEventListener?.('change', motionChanged)
  strip.addEventListener('click', click); strip.addEventListener('wheel', wheel, { passive: false }); strip.addEventListener('keydown', keydown)
  scrollport.addEventListener('scroll', onScroll, { passive: true }); scrollport.addEventListener('wheel', cancel, { passive: true })
  scrollport.addEventListener('touchstart', readerPointer, { passive: true }); scrollport.addEventListener('pointerdown', readerPointer, { passive: true })
  scrollport.addEventListener('keydown', readerKey)
  const listStop = ctx.sessions.list.subscribe(() => { retries = 0; bind() })
  const selectedStop = selection.subscribe(() => { retries = 0; bind() })
  const syncPalette = (): void => {
    const style = paletteStyle(settings.getSnapshot())
    for (const kind of Object.keys(COLOR_FIELDS)) {
      for (const suffix of ['color', 'active-color']) {
        const name = `--smcp-${kind}-${suffix}`
        if (style[name] === undefined) strip.style.removeProperty(name)
        else strip.style.setProperty(name, style[name])
      }
    }
  }
  syncPalette()
  let settingsLanguage = settings.getSnapshot().language
  const settingsStop = settings.subscribe(() => {
    syncPalette()
    const language = settings.getSnapshot().language
    const translatedItems = language !== settingsLanguage ? DIRTY_NODES | DIRTY_TURNS : 0
    settingsLanguage = language
    schedule(translatedItems | DIRTY_LAYOUT | DIRTY_VIEW)
  })
  const dispose = (): void => {
    if (!alive) return
    alive = false; activation++; landing.cancel()
    clearPointer()
    motionPreference?.removeEventListener?.('change', motionChanged)
    if (binding?.session.sessionId === selection.getSnapshot()) owner.cancel()
    owner.release(); sourceStop?.(); listStop(); selectedStop(); settingsStop(); structureDom.disconnect(); nativeStructureDom.disconnect(); attributeDom.disconnect(); composerDom?.disconnect(); resize?.disconnect()
    if (retry !== undefined) clearTimeout(retry)
    clearStreamRefresh(true)
    if (frame !== 0) window.cancelAnimationFrame(frame)
    scrollport.removeEventListener('scroll', onScroll); scrollport.removeEventListener('wheel', cancel)
    scrollport.removeEventListener('touchstart', readerPointer); scrollport.removeEventListener('pointerdown', readerPointer)
    scrollport.removeEventListener('keydown', readerKey)
    strip.remove(); tooltip.remove(); style.remove()
    if (forcedPosition && root.style.position === 'relative') root.style.position = originalPosition
    if (debugHost.__smcpDebug === debug) delete debugHost.__smcpDebug
  }
  try { bind() } catch (error) { dispose(); throw error }
  return dispose
}
