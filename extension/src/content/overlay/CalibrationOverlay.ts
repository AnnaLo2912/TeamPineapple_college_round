import { CALIBRATION_POINTS, TARGET_SIZE, PULSE_DURATION } from '../../shared/constants'

export class CalibrationOverlay {
  private container: HTMLElement | null = null
  private targetElements: HTMLElement[] = []
  private progressContainer: HTMLElement | null = null
  private currentPointIndex: number = 0
  private progress: { current: number; total: number } = { current: 0, total: 5 }
  private pulsePhase: number = 0
  private animationId: number | null = null
  private onCancelCallback: (() => void) | null = null
  private onCompleteCallback: (() => void) | null = null
  private titleElement: HTMLElement | null = null

  constructor() {
    this.createOverlay()
  }

  private createOverlay() {
    this.container = document.createElement('div')
    this.container.className = 'handsfree-calibration-overlay'
    this.container.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(0, 0, 0, 0.92);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, sans-serif;
      color: white;
      cursor: crosshair;
      display: none;
      animation: handsfree-fade-in 0.2s ease-out;
    `
    this.container.onclick = () => this.cancel()

    // Create all 5 target elements upfront
    for (let i = 0; i < 5; i++) {
      const targetContainer = document.createElement('div')
      targetContainer.style.cssText = `
        position: absolute;
        pointer-events: none;
        display: none;
      `
      this.targetElements.push(targetContainer)
      this.container.appendChild(targetContainer)
    }

    const header = document.createElement('div')
    header.style.cssText = `
      position: absolute;
      top: 60px;
      left: 0;
      right: 0;
      text-align: center;
    `
    const title = document.createElement('h2')
    title.style.cssText = `
      margin: 0;
      font-size: 28px;
      font-weight: 600;
      letter-spacing: -0.5px;
    `
    this.titleElement = title
    header.appendChild(title)

    const subtitle = document.createElement('p')
    subtitle.style.cssText = `
      margin: 8px 0 0;
      font-size: 16px;
      opacity: 0.8;
    `
    subtitle.textContent = 'Look at / Point to the pulsing target'
    header.appendChild(subtitle)
    this.container.appendChild(header)

    const progressBar = document.createElement('div')
    progressBar.style.cssText = `
      position: absolute;
      bottom: 80px;
      display: flex;
      gap: 10px;
      align-items: center;
    `
    this.progressContainer = progressBar
    this.container.appendChild(progressBar)

    const hint = document.createElement('div')
    hint.style.cssText = `
      position: absolute;
      bottom: 40px;
      font-size: 13px;
      opacity: 0.6;
    `
    hint.innerHTML = 'Press <kbd style="background:rgba(255,255,255,0.15);padding:2px 8px;border-radius:4px;margin:0 4px;font-family:inherit;">Esc</kbd> to cancel'
    this.container.appendChild(hint)

    document.body.appendChild(this.container)

    if (!document.getElementById('handsfree-calibration-styles')) {
      const style = document.createElement('style')
      style.id = 'handsfree-calibration-styles'
      style.textContent = `
        @keyframes handsfree-ring-pulse {
          0% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.3); opacity: 0.2; }
          100% { transform: scale(1); opacity: 0.6; }
        }
        @keyframes handsfree-center-pulse {
          0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(78, 205, 196, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 20px rgba(78, 205, 196, 0); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(78, 205, 196, 0); }
        }
        @keyframes handsfree-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `
      document.head.appendChild(style)
    }
  }

  getCalibrationTargets(): HTMLElement[] {
    return this.targetElements
  }

  setCurrentPointIndex(index: number) {
    this.currentPointIndex = index
    this.progress = { current: index + 1, total: this.targetElements.length || 5 }
    this.renderAllTargets()
    this.updateProgressUI()
  }

  show(mode: 'face' | 'hand', onCancel: () => void, onComplete: () => void) {
    this.onCancelCallback = onCancel
    this.onCompleteCallback = onComplete
    this.currentPointIndex = 0
    this.progress = { current: 0, total: 5 }

    if (this.titleElement) {
      this.titleElement.textContent = mode === 'face' ? '👁️ Face Calibration' : '✋ Hand Calibration'
    }
    this.updateProgressUI()

    // Show all targets at their positions
    this.renderAllTargets()

    if (this.container) {
      this.container.style.display = 'flex'
    }

    this.startAnimation()
  }

  private startAnimation() {
    this.stopAnimation()
    this.animate()
  }

  private stopAnimation() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  private animate = () => {
    this.pulsePhase = (this.pulsePhase + 0.02) % (Math.PI * 2)
    this.renderTargets()
    this.animationId = requestAnimationFrame(this.animate)
  }

  private renderAllTargets() {
    if (!this.container) return

    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    CALIBRATION_POINTS.forEach((point, index) => {
      const targetEl = this.targetElements[index]
      if (!targetEl) return

      const x = point.x * viewportWidth
      const y = point.y * viewportHeight

      targetEl.style.left = `${x - TARGET_SIZE}px`
      targetEl.style.top = `${y - TARGET_SIZE}px`
      targetEl.style.display = index === this.currentPointIndex ? 'block' : 'none'

      if (index === this.currentPointIndex) {
        const pulseScale = 1 + Math.sin(this.pulsePhase) * 0.15

        targetEl.innerHTML = `
          <div style="
            width: ${TARGET_SIZE * 3}px;
            height: ${TARGET_SIZE * 3}px;
            border-radius: 50%;
            border: 2px solid #4ecdc4;
            opacity: 0.4;
            animation: handsfree-ring-pulse ${PULSE_DURATION}ms ease-out infinite;
            transform-origin: center;
          "></div>
          <div style="
            position: absolute;
            left: ${TARGET_SIZE}px;
            top: ${TARGET_SIZE}px;
            width: ${TARGET_SIZE}px;
            height: ${TARGET_SIZE}px;
            border-radius: 50%;
            background: radial-gradient(circle at 30% 30%, #4ecdc4, #2a9d8f);
            box-shadow: 0 0 20px rgba(78, 205, 196, 0.8), inset 0 -4px 8px rgba(0,0,0,0.3);
            transform: scale(${pulseScale});
            transform-origin: center;
            transition: transform 100ms ease-out;
          ">
            <div style="
              position: absolute;
              inset: 4px;
              border-radius: 50%;
              background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.3), transparent);
            "></div>
          </div>
        `
      } else {
        targetEl.innerHTML = `
          <div style="
            width: ${TARGET_SIZE * 2}px;
            height: ${TARGET_SIZE * 2}px;
            border-radius: 50%;
            border: 2px solid rgba(78, 205, 196, 0.4);
            opacity: 0.3;
            transform-origin: center;
          "></div>
          <div style="
            position: absolute;
            left: ${TARGET_SIZE}px;
            top: ${TARGET_SIZE}px;
            width: ${TARGET_SIZE}px;
            height: ${TARGET_SIZE}px;
            border-radius: 50%;
            background: rgba(78, 205, 196, 0.3);
          "></div>
        `
      }
    })
  }

  private renderTargets() {
    if (!this.container) return

    const pulseScale = 1 + Math.sin(this.pulsePhase) * 0.15

    // Update current target pulse
    const currentTarget = this.targetElements[this.currentPointIndex]
    if (currentTarget) {
      const centerDiv = currentTarget.querySelector('div[style*="radial-gradient(circle at 30% 30%"]')
      if (centerDiv) {
        (centerDiv as HTMLElement).style.transform = `scale(${pulseScale})`
      }
    }
  }

  updateProgressUI() {
    if (!this.progressContainer) return

    this.progressContainer.innerHTML = ''

    for (let i = 0; i < 5; i++) {
      const dot = document.createElement('div')
      const isCompleted = i < this.progress.current - 1
      const isCurrent = i === this.progress.current - 1

      dot.style.cssText = `
        width: ${isCompleted ? '28px' : '12px'};
        height: 12px;
        border-radius: 6px;
        background: ${isCompleted ? '#4ecdc4' : 'rgba(255,255,255,0.3)'};
        transition: all 300ms ease;
        box-shadow: ${isCurrent ? '0 0 8px #4ecdc4' : 'none'};
      `
      this.progressContainer.appendChild(dot)
    }

    const label = document.createElement('span')
    label.style.cssText = `
      margin-left: 12px;
      font-size: 14px;
      opacity: 0.7;
      font-variant-numeric: tabular-nums;
    `
    label.textContent = `${this.progress.current} / ${this.progress.total}`
    this.progressContainer.appendChild(label)
  }

  hide() {
    if (this.container) {
      this.container.style.display = 'none'
    }
    this.stopAnimation()
    this.onCancelCallback = null
    this.onCompleteCallback = null
  }

  cancel() {
    this.onCancelCallback?.()
    this.hide()
  }

  complete() {
    this.onCompleteCallback?.()
    this.hide()
  }

  destroy() {
    this.stopAnimation()
    this.container?.remove()
    this.container = null
  }
}