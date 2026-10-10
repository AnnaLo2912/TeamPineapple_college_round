import type { ClickableElement, Point } from '../../shared/types'
import { CLICKABLE_SELECTORS, EXCLUDED_TAGS } from '../../shared/constants'

export class TargetDetector {
  private cachedTargets: ClickableElement[] = []
  private lastCacheTime: number = 0
  private cacheTimeout: number = 200
  private observer: MutationObserver | null = null
  private onTargetsChangeCallback: ((targets: ClickableElement[]) => void) | null = null

  constructor() {
    this.setupObserver()
  }

  private setupObserver() {
    this.observer = new MutationObserver(() => {
      this.invalidateCache()
    })
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'disabled', 'role', 'onclick', 'data-clickable'],
    })
  }

  invalidateCache() {
    this.lastCacheTime = 0
  }

  getTargets(forceRefresh = false): ClickableElement[] {
    const now = Date.now()
    if (!forceRefresh && this.cachedTargets.length > 0 && now - this.lastCacheTime < this.cacheTimeout) {
      return this.cachedTargets
    }

    this.cachedTargets = this.scanTargets()
    this.lastCacheTime = now

    if (this.onTargetsChangeCallback) {
      this.onTargetsChangeCallback(this.cachedTargets)
    }

    return this.cachedTargets
  }

  private scanTargets(): ClickableElement[] {
    const selector = CLICKABLE_SELECTORS.join(', ')
    const elements = document.querySelectorAll<HTMLElement>(selector)
    const targets: ClickableElement[] = []

    elements.forEach(el => {
      if (EXCLUDED_TAGS.includes(el.tagName)) return
      if (el.offsetParent === null && el.tagName !== 'BODY') return
      if (el.getAttribute('aria-hidden') === 'true') return
      if (el.style.display === 'none' || el.style.visibility === 'hidden') return
      if (el.style.opacity === '0') return

      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return

      const center = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      }

      const tagName = el.tagName.toLowerCase()
      const type = el.getAttribute('type')?.toLowerCase() || ''

      targets.push({
        element: el,
        rect,
        center,
        tagName,
        type,
        isInput: ['input', 'textarea', 'select'].includes(tagName),
        isLink: tagName === 'a' || el.getAttribute('role') === 'link',
        isButton: tagName === 'button' || el.getAttribute('role') === 'button' || type === 'button' || type === 'submit',
      })
    })

    return targets
  }

  getTargetAtPoint(x: number, y: number, radius: number = 20): ClickableElement | null {
    const targets = this.getTargets()
    let bestTarget: ClickableElement | null = null
    let bestDistance = Infinity

    for (const target of targets) {
      const dx = target.center.x - x
      const dy = target.center.y - y
      const dist = Math.hypot(dx, dy)

      if (dist <= radius && dist < bestDistance) {
        bestDistance = dist
        bestTarget = target
      }
    }

    return bestTarget
  }

  getMagneticTarget(x: number, y: number, magneticRadius: number = 40): ClickableElement | null {
    const targets = this.getTargets()
    let bestTarget: ClickableElement | null = null
    let bestDistance = Infinity

    for (const target of targets) {
      const dx = target.center.x - x
      const dy = target.center.y - y
      const dist = Math.hypot(dx, dy)

      if (dist <= magneticRadius && dist < bestDistance) {
        bestDistance = dist
        bestTarget = target
      }
    }

    return bestTarget
  }

  applyMagneticSnap(cursorX: number, cursorY: number, magneticRadius: number, snapStrength: number): { x: number; y: number } | null {
    const target = this.getMagneticTarget(cursorX, cursorY, magneticRadius)
    if (!target) return null

    const dx = target.center.x - cursorX
    const dy = target.center.y - cursorY
    const dist = Math.hypot(dx, dy)

    if (dist === 0) return { x: cursorX, y: cursorY }

    const factor = snapStrength * (1 - dist / magneticRadius)
    return {
      x: cursorX + dx * factor,
      y: cursorY + dy * factor,
    }
  }

  onTargetsChange(callback: (targets: ClickableElement[]) => void) {
    this.onTargetsChangeCallback = callback
  }

  destroy() {
    this.observer?.disconnect()
    this.observer = null
    this.cachedTargets = []
  }
}

export const targetDetector = new TargetDetector()