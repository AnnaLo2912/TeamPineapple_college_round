import type { ClickableElement } from '../../shared/types'
import {
  CLICKABLE_SELECTORS,
  EXCLUDED_TAGS,
  DWELL_DETECT_RADIUS,
  DWELL_MIN_HITBOX,
} from '../../shared/constants'

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
      if (el.closest('[class*="handsfree-"]')) return
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

  private getInflate(target: ClickableElement): number {
    const minSide = Math.min(target.rect.width, target.rect.height)
    return Math.max(0, (DWELL_MIN_HITBOX - minSide) / 2)
  }

  getTargetAtPoint(
    x: number,
    y: number,
    radius: number = DWELL_DETECT_RADIUS
  ): ClickableElement | null {
    const targets = this.getTargets()
    let insideBest: ClickableElement | null = null
    let insideArea = Infinity
    let nearBest: ClickableElement | null = null
    let nearDistance = Infinity

    for (const target of targets) {
      const inflate = this.getInflate(target)
      const inside =
        x >= target.rect.left - inflate &&
        x <= target.rect.right + inflate &&
        y >= target.rect.top - inflate &&
        y <= target.rect.bottom + inflate

      if (inside) {
        const area = Math.max(target.rect.width * target.rect.height, 1)
        if (area < insideArea) {
          insideArea = area
          insideBest = target
        }
        continue
      }

      const dist = Math.hypot(target.center.x - x, target.center.y - y)
      if (dist <= radius && dist < nearDistance) {
        nearDistance = dist
        nearBest = target
      }
    }

    return insideBest ?? nearBest
  }

  getMagneticTarget(x: number, y: number, magneticRadius: number = 64): ClickableElement | null {
    const targets = this.getTargets()
    let bestTarget: ClickableElement | null = null
    let bestDistance = Infinity

    for (const target of targets) {
      const inflate = this.getInflate(target)
      const inside =
        x >= target.rect.left - inflate &&
        x <= target.rect.right + inflate &&
        y >= target.rect.top - inflate &&
        y <= target.rect.bottom + inflate

      const dist = Math.hypot(target.center.x - x, target.center.y - y)
      const score = inside ? -1 : dist

      if ((inside || dist <= magneticRadius) && score < bestDistance) {
        bestDistance = score
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

    const inflate = this.getInflate(target)
    const inside =
      cursorX >= target.rect.left - inflate &&
      cursorX <= target.rect.right + inflate &&
      cursorY >= target.rect.top - inflate &&
      cursorY <= target.rect.bottom + inflate

    const factor = inside
      ? snapStrength
      : snapStrength * (1 - dist / magneticRadius)

    return {
      x: cursorX + dx * Math.max(0, Math.min(factor, 1)),
      y: cursorY + dy * Math.max(0, Math.min(factor, 1)),
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