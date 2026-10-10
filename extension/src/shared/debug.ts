// Diagnostic logging for the tracking pipeline. Set DEBUG to false (or build
// with NODE_ENV!=production wiring) once everything works to silence it.
export const DEBUG = true

export function debugLog(scope: string, ...args: unknown[]) {
  if (!DEBUG) return
  console.log(`[handsfree:${scope}]`, ...args)
}

const counters = new Map<string, number>()

export function debugEvery(scope: string, every: number, ...args: unknown[]) {
  if (!DEBUG) return
  const n = (counters.get(scope) || 0) + 1
  counters.set(scope, n)
  if (n % every === 0) {
    console.log(`[handsfree:${scope}]`, ...args)
  }
}
