export class TabDock {
  private dockElement: HTMLElement | null = null

  constructor() {
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
      gap: 6px;
      padding: 6px;
      background: rgba(10, 10, 20, 0.6);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      backdrop-filter: blur(6px);
      z-index: 2147483646;
    `

    this.dockElement.appendChild(this.makeButton('◀', 'Previous tab', () => this.sendCommand('CMD_PREV_TAB')))
    this.dockElement.appendChild(this.makeButton('▶', 'Next tab', () => this.sendCommand('CMD_NEXT_TAB')))
    this.dockElement.appendChild(this.makeButton('▲', 'Scroll up', () => this.scrollPage(-1)))
    this.dockElement.appendChild(this.makeButton('▼', 'Scroll down', () => this.scrollPage(1)))
    this.dockElement.appendChild(this.makeButton('◎', 'Recenter cursor', () => this.sendCommand('RECENTER')))

    document.body.appendChild(this.dockElement)
  }

  private makeButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.title = title
    button.style.cssText = `
      width: 34px;
      height: 34px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255,255,255,0.12);
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
      button.style.background = 'rgba(255,255,255,0.12)'
      button.style.borderColor = 'rgba(255,255,255,0.14)'
    })
    button.addEventListener('click', onClick)
    return button
  }

  private sendCommand(type: string) {
    chrome.runtime.sendMessage({ type, timestamp: Date.now() }, () => void chrome.runtime.lastError)
  }

  private scrollPage(direction: -1 | 1) {
    window.scrollBy({ top: direction * Math.round(window.innerHeight * 0.9), behavior: 'smooth' })
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