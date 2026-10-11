export class TargetHighlighter {
  constructor() {
    this.highlightElement = null
    this.currentTarget = null
    this.createHighlightElement()
  }

  createHighlightElement() {
    this.highlightElement = document.createElement('div')
    this.highlightElement.className = 'handsfree-highlight'
    this.highlightElement.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 2147483645;
      border-radius: 4px;
      display: none;
      box-shadow: 0 0 0 2px #4ecdc4, 0 0 12px 4px rgba(78, 205, 196, 0.4);
      animation: handsfree-pulse 1.5s ease-in-out infinite;
    `
    document.body.appendChild(this.highlightElement)

    if (!document.getElementById('handsfree-highlight-styles')) {
      const style = document.createElement('style')
      style.id = 'handsfree-highlight-styles'
      style.textContent = `
        @keyframes handsfree-pulse {
          0%, 100% { box-shadow: 0 0 0 2px #4ecdc4, 0 0 12px 4px rgba(78, 205, 196, 0.4); }
          50% { box-shadow: 0 0 0 3px #4ecdc4, 0 0 20px 6px rgba(78, 205, 196, 0.6); }
        }
      `
      document.head.appendChild(style)
    }
  }

  updateTarget(target) {
    this.currentTarget = target

    if (!target || !this.highlightElement) {
      this.hide()
      return
    }

    const { rect } = target
    const padding = 4

    this.highlightElement.style.display = 'block'
    this.highlightElement.style.left = `${rect.left - padding}px`
    this.highlightElement.style.top = `${rect.top - padding}px`
    this.highlightElement.style.width = `${rect.width + padding * 2}px`
    this.highlightElement.style.height = `${rect.height + padding * 2}px`
  }

  hide() {
    if (this.highlightElement) {
      this.highlightElement.style.display = 'none'
    }
    this.currentTarget = null
  }

  setArmed(isArmed) {
    if (!this.highlightElement) return
    if (isArmed) {
      this.highlightElement.style.boxShadow =
        '0 0 0 3px #22c55e, 0 0 20px 6px rgba(34, 197, 94, 0.65)'
    } else {
      this.highlightElement.style.boxShadow =
        '0 0 0 2px #4ecdc4, 0 0 12px 4px rgba(78, 205, 196, 0.4)'
    }
  }

  destroy() {
    this.highlightElement?.remove()
    this.highlightElement = null
  }
}
