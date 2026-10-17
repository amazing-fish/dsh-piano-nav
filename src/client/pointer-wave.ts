/** Finite amplitude envelope. The strip owns the single animation-frame queue. */
export interface PointerWaveAnchor { key: string; offset: number }
export const POINTER_WAVE_DURATION_MS = 96

export function createPointerWave() {
  let anchor: PointerWaveAnchor | null = null
  let from = 0
  let target = 0
  let started = 0
  const sample = (now: number, reducedMotion = false) => {
    const progress = reducedMotion ? 1 : Math.max(0, Math.min(1, (now - started) / POINTER_WAVE_DURATION_MS))
    const strength = from + (target - from) * (1 - (1 - progress) ** 3)
    const moving = !reducedMotion && from !== target && progress < 1
    if (!moving) { from = target; if (target === 0) anchor = null }
    return { anchor, strength: moving ? strength : target, moving }
  }
  return {
    sample,
    point(next: PointerWaveAnchor | null, now: number, reducedMotion = false, paintedStrength = 0): void {
      let current = sample(now, reducedMotion).strength
      // First acquisition can take over a keyboard wave already on screen.
      if (next !== null && anchor === null) current = Math.max(0, Math.min(1, paintedStrength))
      if (next !== null) anchor = next
      const desired = next === null ? 0 : 1
      // A new Y coordinate or repeated outside sample never restarts a fade.
      if (desired === target) return
      from = current; target = desired; started = now
    },
    reset(): void { anchor = null; from = target = started = 0 },
  }
}
