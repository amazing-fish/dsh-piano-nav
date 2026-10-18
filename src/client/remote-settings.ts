/**
 * Remote-backed settings source for the DSH 0.1.7 settings contract.
 * Ported from the upstream 1.2.6 line (2026-09-27): the client-side
 * `settingsScope` service was removed in 0.1.7, so the settings page now
 * reads its entry through `remote.settings.describe()` and writes through
 * `remote.settings.mutate()` instead.
 */

import { DEFAULT_SETTINGS, SETTINGS_ENTRY_ID, SETTINGS_FIELDS, decodeSettings } from '../core/config.ts'
import { COLOR_FIELDS, isPianoColor } from '../core/colors.ts'
import type { PianoSettings, PianoSettingsScope, PianoSettingsSource } from '../core/config.ts'

/** Structural slice of the remote API this module consumes. */
export interface PianoSettingsRemote {
  settings: {
    describe(): Promise<PianoSettingsDescribeResponse>
    mutate(ns: string, ops: PianoSettingsWriteOp[], revision: number): Promise<PianoSettingsMutateResponse>
  }
  $on(event: 'settings/document-updated', listener: (ns: string) => void): () => void
}

interface PianoSettingsEntryView {
  ns?: string
  revision?: number
  value?: unknown
}

interface PianoSettingsDescribeResponse {
  ok: boolean
  value: {
    namespaces: PianoSettingsEntryView[]
    writable: boolean
  }
}

interface PianoSettingsMutateResponse {
  ok: boolean
  value: PianoSettingsEntryView
}

interface PianoSettingsWriteOp {
  op: 'set' | 'unset'
  path: [keyof PianoSettings & string]
  value?: unknown
}

type PianoSettingsSnapshot = ReturnType<PianoSettingsScope['getSnapshot']>
interface WriteBatch { ops: PianoSettingsWriteOp[] }
const COLOR_SETTING_FIELDS = new Set<keyof PianoSettings>(Object.values(COLOR_FIELDS))

export interface PianoRemoteSettings {
  scope: PianoSettingsScope
  source: PianoSettingsSource
  dispose(): void
}

/**
 * Keep one remote settings controller per plugin instance. Reads refresh on
 * `settings/document-updated` for this entry only; writes are serialized
 * through a queue and revalidate the entry revision on failure. Consecutive
 * unstarted edits of one color share the latest value and completion promise.
 * Color-only previews publish immediately; a batch may retire only its own
 * still-current previews after confirmation or failure.
 */
export function createPianoRemoteSettings(remote: PianoSettingsRemote): PianoRemoteSettings {
  let entry: PianoSettingsEntryView | undefined
  let described = false
  /**
   * Fail-closed value for states where the persisted preference is unknown
   * (loading, or unavailable before the first successful describe): the rail
   * must not claim the native navigator until the stored `enabled` value is
   * known, so a disabled installation is never re-enabled by default.
   */
  const unknownSettings = (): PianoSettings => ({ ...DEFAULT_SETTINGS, enabled: false })
  let snapshot: PianoSettingsSnapshot = {
    status: 'loading',
    writable: false,
    revision: 0,
    value: unknownSettings(),
  }
  let disposed = false
  let readGeneration = 0
  let writeQueue: Promise<void> = Promise.resolve()
  // One preview per color, shared by the picker, legend, demo and real rail.
  const colorPreviews = new Map<keyof PianoSettings, { batch: WriteBatch; value: string }>()
  let pendingColor: {
    field: keyof PianoSettings
    batch: WriteBatch
    operation: Promise<void>
  } | undefined
  const listeners = new Set<() => void>()

  const publish = (status: PianoSettingsSnapshot['status'], writable: boolean): void => {
    if (disposed) return
    const confirmed = entry === undefined ? (described ? DEFAULT_SETTINGS : unknownSettings()) : decodeSettings(entry.value) ?? DEFAULT_SETTINGS
    const preview = status === 'ready' && writable ? Object.fromEntries([...colorPreviews].map(([field, choice]) => [field, choice.value])) : {}
    snapshot = {
      status,
      writable,
      revision: entry?.revision ?? 0,
      value: { ...confirmed, ...preview },
      saving: status === 'ready' && writable && colorPreviews.size > 0,
    }
    for (const listener of listeners) listener()
  }

  const acceptEntry = (next: PianoSettingsEntryView | undefined): void => {
    // A describe begun before an acknowledgment can finish after it.
    if (next?.revision !== undefined && entry?.revision !== undefined && next.revision < entry.revision) return
    entry = next
  }
  const previewColors = (batch: WriteBatch): void => {
    if (disposed || snapshot.status !== 'ready' || !snapshot.writable) return
    let changed = false
    for (const op of batch.ops) {
      const value = op.op === 'unset' ? '' : op.value
      if (COLOR_SETTING_FIELDS.has(op.path[0]) && isPianoColor(value)) {
        colorPreviews.set(op.path[0], { batch, value }); changed = true
      }
    }
    if (changed) publish(snapshot.status, snapshot.writable)
  }

  const refresh = async (): Promise<void> => {
    const generation = ++readGeneration
    try {
      const response = await remote.settings.describe()
      if (disposed || generation !== readGeneration) return
      if (!response.ok) throw new Error('settings describe failed')
      const result = response.value
      acceptEntry(result.namespaces.find((candidate) => candidate.ns === SETTINGS_ENTRY_ID))
      described = true
      // A writable document without this entry cannot be written yet: DSH 0.1.7
      // `describe()` only lists active entries exporting a Config, and
      // `mutate()` throws "No configurable plugin entry" for any other id.
      // The entry appears (with `settings/document-updated`) once the host
      // half activates, so keep controls disabled until then.
      publish(entry === undefined ? 'unavailable' : 'ready', entry !== undefined && result.writable)
    } catch {
      if (disposed || generation !== readGeneration) return
      publish('unavailable', false)
    }
  }

  const write = (ops: PianoSettingsWriteOp[], colorField?: keyof PianoSettings): Promise<void> => {
    if (colorField !== undefined && pendingColor?.field === colorField) {
      pendingColor.batch.ops = ops
      previewColors(pendingColor.batch)
      return pendingColor.operation
    }
    const batch = { ops }
    const operation = writeQueue.then(async () => {
      // An in-flight request is immutable; only its unstarted successor can merge.
      if (pendingColor?.batch === batch) pendingColor = undefined
      let committed = false
      try {
        if (disposed) throw new Error('settings controller disposed')
        if (entry === undefined || !snapshot.writable) await refresh()
        if (entry === undefined || !snapshot.writable) throw new Error('settings unavailable')
        const revision = entry.revision ?? 0
        const response = await remote.settings.mutate(SETTINGS_ENTRY_ID, batch.ops, revision)
        if (!response.ok) throw new Error('settings mutation failed')
        acceptEntry(response.value)
        committed = true
      } catch (error) {
        if (!disposed) {
          console.warn('[dsh-piano-nav] Settings write failed', error)
          await refresh()
        }
        throw error
      } finally {
        for (const [field, choice] of colorPreviews) {
          if (choice.batch === batch) colorPreviews.delete(field)
        }
        publish(committed ? 'ready' : snapshot.status, snapshot.writable)
      }
    })
    // Other fields, unset and reset form ordering boundaries for coalescing.
    pendingColor = colorField === undefined ? undefined : { field: colorField, batch, operation }
    writeQueue = operation.catch(() => {})
    previewColors(batch)
    return operation
  }

  const scope: PianoSettingsScope = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: (field, value) => write([{ op: 'set', path: [field], value }], COLOR_SETTING_FIELDS.has(field) ? field : undefined),
    unset: (field) => write([{ op: 'unset', path: [field] }]),
    reset: (fields = SETTINGS_FIELDS) => write(fields.map((field) => ({
      op: 'unset' as const,
      path: [field] as [keyof PianoSettings & string],
    }))),
  }

  const source: PianoSettingsSource = {
    getSnapshot: () => snapshot.value,
    subscribe: scope.subscribe,
  }

  const stopListening = remote.$on('settings/document-updated', (ns) => {
    if (ns === SETTINGS_ENTRY_ID) void refresh()
  })
  void refresh()

  return {
    scope,
    source,
    dispose: () => {
      disposed = true
      readGeneration += 1
      colorPreviews.clear()
      stopListening()
      listeners.clear()
    },
  }
}
