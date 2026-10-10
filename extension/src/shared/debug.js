export const DEBUG = false

export function debugLog(scope, ...args) {
  if (!DEBUG) return
  console.log(`[handsfree:${scope}]`, ...args)
}

const counters = new Map()

export function debugEvery(scope, every, ...args) {
  if (!DEBUG) return
  const n = (counters.get(scope) || 0) + 1
  counters.set(scope, n)
  if (n % every === 0) {
    console.log(`[handsfree:${scope}]`, ...args)
  }
}
