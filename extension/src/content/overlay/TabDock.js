export class TabDock {
  constructor(callbacks) {
    this.callbacks = callbacks
    this.dockElement = null
    this.buttons = []
    this.createElements()
  }

  createElements() {
    this.dockElement = document.createElement('div')
    this.dockElement.className = 'handsfree-tab-dock'
    this.dockElement.style.cssText = `
      position: fixed;
      left: 8px;
      top: 50%;
      transform: translateY(-50%);
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 10px;
      background: rgba(10, 10, 20, 0.66);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      backdrop-filter: blur(6px);
      z-index: 2147483646;
    `

    this.row([
      this.button('◀', 'Cursor left', 'nudge', 'nudge-left', 'left', true),
      this.button('▲', 'Cursor up', 'nudge', 'nudge-up', 'up', true),
      this.button('▶', 'Cursor right', 'nudge', 'nudge-right', 'right', true),
    ])
    this.row([
      this.button('▼', 'Cursor down', 'nudge', 'nudge-down', 'down', true),
      this.button('■', 'Stop', 'stop', 'stop'),
    ])
    this.divider()
    this.row([
      this.button('⇈', 'Scroll up', 'scroll', 'scroll-up', undefined, false, -1),
      this.button('⇊', 'Scroll down', 'scroll', 'scroll-down', undefined, false, 1),
    ])
    this.row([
      this.button('◧', 'Previous tab', 'tab', 'tab-prev', undefined, false, -1),
      this.button('◎', 'Recenter', 'recenter', 'recenter'),
      this.button('◨', 'Next tab', 'tab', 'tab-next', undefined, false, 1),
    ])

    document.body.appendChild(this.dockElement)
  }

  row(buttons) {
    if (!this.dockElement) return
    const row = document.createElement('div')
    row.style.cssText = 'display: flex; gap: 12px;'
    for (const b of buttons) row.appendChild(b)
    this.dockElement.appendChild(row)
  }

  divider() {
    if (!this.dockElement) return
    const line = document.createElement('div')
    line.style.cssText = 'width: 100%; height: 1px; background: rgba(255,255,255,0.12);'
    this.dockElement.appendChild(line)
  }

  button(label, title, kind, action, dir, primary = false, scrollDir) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.title = title
    button.dataset.handsfreeAction = action
    const size = primary ? '48px' : '40px'
    const baseBg = primary ? 'rgba(78,205,196,0.18)' : 'rgba(255,255,255,0.12)'
    button.style.cssText = `
      width: ${size};
      height: ${size};
      display: flex;
      align-items: center;
      justify-content: center;
      background: ${baseBg};
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 10px;
      color: #eaeaea;
      font-size: ${primary ? '18px' : '15px'};
      line-height: 1;
      cursor: pointer;
      transition: all 0.15s ease;
    `

    const record = { element: button, action, kind, dir }
    this.buttons.push(record)

    button.addEventListener('mouseenter', () => {
      button.style.background = 'rgba(78,205,196,0.35)'
      button.style.borderColor = 'rgba(78,205,196,0.6)'
    })
    button.addEventListener('mouseleave', () => {
      button.style.background = baseBg
      button.style.borderColor = 'rgba(255,255,255,0.14)'
    })
    button.addEventListener('click', () => {
      switch (kind) {
        case 'nudge':
          this.callbacks.onNudge(dir)
          break
        case 'stop':
          this.callbacks.onStop()
          break
        case 'scroll':
          this.callbacks.onScroll(scrollDir ?? 1, button)
          break
        case 'recenter':
          this.callbacks.onRecenter()
          break
        case 'tab':
          this.callbacks.onTab(dir)
          break
      }
    })
    return button
  }

  hitTest(x, y) {
    for (const b of this.buttons) {
      const rect = b.element.getBoundingClientRect()
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return { element: b.element, action: b.action, rect }
      }
    }
    return null
  }

  isOverDock(x, y) {
    const el = this.dockElement
    if (!el) return false
    const rect = el.getBoundingClientRect()
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  show() {
    if (this.dockElement) {
      this.dockElement.style.display = 'flex'
    }
  }

  hide() {
    if (this.dockElement) {
      this.dockElement.style.display = 'none'
    }
  }

  destroy() {
    this.dockElement?.remove()
    this.dockElement = null
    this.buttons = []
  }
}
