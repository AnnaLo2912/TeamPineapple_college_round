export type NudgeDirection = 'up' | 'down' | 'left' | 'right'
export type TabDirection = -1 | 1

export interface TabDockCallbacks {
  onNudge: (dir: NudgeDirection) => void
  onStop: () => void
  onScroll: (dir: -1 | 1) => void
  onRecenter: () => void
  onTab: (dir: TabDirection) => void
}

export class TabDock {
  private dockElement: HTMLElement | null = null

  constructor(private callbacks: TabDockCallbacks) {
    this.createElements()
  }

  private createElements() {
    this.dockElement = document.createElement('div')
    this.dockElement.className = 'handsfree-tab-dock'
    this.dockElement.style.cssText = `
      position: fixed;
      left: 6px;
      top: 50%;
      transform: translateY(-50%);
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 6px;
      background: rgba(10, 10, 20, 0.6);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      backdrop-filter: blur(6px);
      z-index: 2147483646;
    `

    this.row([
      this.makeButton('◀', 'Cursor left', () => this.callbacks.onNudge('left'), true),
      this.makeButton('▲', 'Cursor up', () => this.callbacks.onNudge('up'), true),
      this.makeButton('▶', 'Cursor right', () => this.callbacks.onNudge('right'), true),
    ])
    this.row([
      this.makeButton('▼', 'Cursor down', () => this.callbacks.onNudge('down'), true),
      this.makeButton('■', 'Stop all', () => this.callbacks.onStop()),
    ])
    this.row([
      this.makeButton('⇈', 'Scroll up (hold)', () => this.callbacks.onScroll(-1)),
      this.makeButton('⇊', 'Scroll down (hold)', () => this.callbacks.onScroll(1)),
    ])
    this.row([
      this.makeButton('◧', 'Previous tab', () => this.callbacks.onTab(-1)),
      this.makeButton('◎', 'Recenter', () => this.callbacks.onRecenter()),
      this.makeButton('◨', 'Next tab', () => this.callbacks.onTab(1)),
    ])

    document.body.appendChild(this.dockElement)
  }

  private row(buttons: HTMLButtonElement[]) {
    if (!this.dockElement) return
    const row = document.createElement('div')
    row.style.cssText = 'display: flex; gap: 6px;'
    for (const b of buttons) row.appendChild(b)
    this.dockElement.appendChild(row)
  }

  private makeButton(
    label: string,
    title: string,
    onClick: () => void,
    primary: boolean = false
  ): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.title = title
    const size = primary ? '38px' : '32px'
    button.style.cssText = `
      width: ${size};
      height: ${size};
      display: flex;
      align-items: center;
      justify-content: center;
      background: ${primary ? 'rgba(78,205,196,0.18)' : 'rgba(255,255,255,0.12)'};
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 8px;
      color: #eaeaea;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      transition: all 0.15s ease;
    `
    button.addEventListener('mouseenter', () => {
      button.style.background = 'rgba(78,205,196,0.35)'
      button.style.borderColor = 'rgba(78,205,196,0.6)'
    })
    button.addEventListener('mouseleave', () => {
      button.style.background = primary ? 'rgba(78,205,196,0.18)' : 'rgba(255,255,255,0.12)'
      button.style.borderColor = 'rgba(255,255,255,0.14)'
    })
    button.addEventListener('click', onClick)
    return button
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
  }
}