export class TabDock {
  constructor(callbacks) {
    this.callbacks = callbacks
    this.dockElement = null
    this.panel = null
    this.tabsToggleButton = null
    this.panelOpen = false
    this.buttons = []
    this.entries = []
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
      this.button('⟳', 'Refresh page', 'nav', 'refresh', undefined, true),
      this.button('‹', 'Back', 'nav', 'back', undefined, true),
      this.button('›', 'Forward', 'nav', 'forward', undefined, true),
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
    this.divider()

    const tabsToggle = this.button('☰  Tabs  ▾', 'Open tab list', 'tabs-toggle', 'tabs-toggle')
    tabsToggle.style.width = '100%'
    tabsToggle.style.justifyContent = 'center'
    this.tabsToggleButton = tabsToggle
    this.row([tabsToggle])

    this.panel = document.createElement('div')
    this.panel.className = 'handsfree-tab-panel'
    this.panel.style.cssText = `
      display: none;
      flex-direction: column;
      gap: 4px;
      width: 190px;
      max-height: 240px;
      overflow-y: auto;
      padding: 6px;
      background: rgba(10, 10, 20, 0.92);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px;
    `
    this.dockElement.appendChild(this.panel)

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
        case 'nav':
          this.callbacks.onNav(action)
          break
        case 'tabs-toggle':
          this.togglePanel()
          break
      }
    })
    return button
  }

  togglePanel() {
    if (this.panelOpen) {
      this.closePanel()
      return
    }
    this.openPanel()
    this.callbacks.onTabsToggle?.()
  }

  openPanel() {
    this.panelOpen = true
    if (this.tabsToggleButton) this.tabsToggleButton.textContent = '☰  Tabs  ▴'
    if (this.panel) this.panel.style.display = 'flex'
  }

  closePanel() {
    this.panelOpen = false
    if (this.tabsToggleButton) this.tabsToggleButton.textContent = '☰  Tabs  ▾'
    if (this.panel) this.panel.style.display = 'none'
  }

  setTabEntries(list) {
    this.clearEntries()
    if (!this.panel) return
    const items = Array.isArray(list) ? list : []
    if (!items.length) {
      const empty = document.createElement('div')
      empty.textContent = 'No tabs'
      empty.style.cssText = 'padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px;'
      this.panel.appendChild(empty)
      return
    }

    for (const tab of items) {
      const entry = document.createElement('button')
      entry.type = 'button'
      entry.className = 'handsfree-tab-entry'
      entry.dataset.handsfreeAction = 'tab-entry'
      const label = tab.title || tab.url || 'Untitled'
      entry.title = label
      entry.textContent = (tab.active ? '● ' : '') + label
      const baseBg = tab.active ? 'rgba(78,205,196,0.22)' : 'rgba(255,255,255,0.06)'
      entry.style.cssText = `
        display: flex;
        align-items: center;
        width: 100%;
        padding: 8px 10px;
        background: ${baseBg};
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 8px;
        color: #eaeaea;
        font-size: 12px;
        line-height: 1.2;
        text-align: left;
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      `
      entry.addEventListener('mouseenter', () => {
        entry.style.background = 'rgba(78,205,196,0.35)'
        entry.style.borderColor = 'rgba(78,205,196,0.6)'
      })
      entry.addEventListener('mouseleave', () => {
        entry.style.background = baseBg
        entry.style.borderColor = 'rgba(255,255,255,0.08)'
      })
      entry.addEventListener('click', () => {
        this.callbacks.onTabJump?.(tab)
        this.closePanel()
      })

      this.entries.push({ element: entry, action: 'tab-entry', kind: 'tab-jump', tab })
      this.panel.appendChild(entry)
    }
  }

  clearEntries() {
    this.entries = []
    if (this.panel) this.panel.replaceChildren()
  }

  hitTest(x, y) {
    for (const b of this.buttons) {
      const rect = b.element.getBoundingClientRect()
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return { element: b.element, action: b.action, rect }
      }
    }
    if (this.panelOpen) {
      for (const e of this.entries) {
        const rect = e.element.getBoundingClientRect()
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return { element: e.element, action: e.action, rect }
        }
      }
    }
    return null
  }

  isOverDock(x, y) {
    const el = this.dockElement
    if (el) {
      const rect = el.getBoundingClientRect()
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return true
      }
    }
    if (this.panelOpen && this.panel) {
      const rect = this.panel.getBoundingClientRect()
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return true
      }
    }
    return false
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
    this.panel = null
    this.tabsToggleButton = null
    this.panelOpen = false
    this.buttons = []
    this.entries = []
  }
}
