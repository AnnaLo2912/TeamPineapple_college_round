import { CURSOR_SIZE, DWELL_RING_SIZE, DWELL_TIME } from '../../shared/constants.js'

export class CursorOverlay {
  constructor(magneticRadius, snapStrength) {
    this.cursorElement = null
    this.svgElement = null
    this.dwellRingElement = null
    this.labelElement = null
    this.statusHud = null
    this.currentPosition = null
    this.targetElement = null
    this.isDwelling = false
    this.dwellProgress = 0
    this.mode = 'face'
    this.magneticRadius = magneticRadius
    this.snapStrength = snapStrength
    this.animationId = null
    this.dwellStartTime = 0
    this.onDwellCompleteCallback = null
    this.dwellTime = DWELL_TIME

    this.createElements()
  }

  createElements() {
    this.cursorElement = document.createElement('div')
    this.cursorElement.className = 'handsfree-cursor'
    this.cursorElement.style.cssText = `
      position: fixed;
      left: 0;
      top: 0;
      width: ${CURSOR_SIZE}px;
      height: ${CURSOR_SIZE}px;
      pointer-events: none;
      z-index: 2147483647;
      transform: translateZ(0);
      will-change: transform, left, top;
      display: none;
    `

    this.svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.svgElement.setAttribute('width', String(CURSOR_SIZE))
    this.svgElement.setAttribute('height', String(CURSOR_SIZE))
    this.svgElement.setAttribute('viewBox', '0 0 24 24')
    this.svgElement.style.overflow = 'visible'
    this.cursorElement.appendChild(this.svgElement)

    this.dwellRingElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.dwellRingElement.setAttribute('width', String(DWELL_RING_SIZE))
    this.dwellRingElement.setAttribute('height', String(DWELL_RING_SIZE))
    this.dwellRingElement.style.cssText = `
      position: absolute;
      left: ${-DWELL_RING_SIZE / 2}px;
      top: ${-DWELL_RING_SIZE / 2}px;
      pointer-events: none;
      display: none;
    `
    this.cursorElement.appendChild(this.dwellRingElement)

    this.labelElement = document.createElement('div')
    this.labelElement.style.cssText = `
      position: absolute;
      padding: 4px 8px;
      background: rgba(0, 0, 0, 0.85);
      color: white;
      border-radius: 4px;
      font-size: 11px;
      font-family: system-ui, sans-serif;
      white-space: nowrap;
      pointer-events: none;
      z-index: 2147483646;
      backdrop-filter: blur(4px);
      border: 1px solid rgba(255,255,255,0.1);
      display: none;
    `
    this.cursorElement.appendChild(this.labelElement)

    this.statusHud = document.createElement('div')
    this.statusHud.className = 'handsfree-status-hud'
    this.statusHud.style.cssText = `
      position: fixed;
      left: 50%;
      bottom: 24px;
      transform: translateX(-50%);
      padding: 8px 16px;
      background: rgba(10, 10, 20, 0.85);
      color: #4ecdc4;
      border: 1px solid rgba(78,205,196,0.5);
      border-radius: 999px;
      font-size: 13px;
      font-family: system-ui, sans-serif;
      font-weight: 600;
      white-space: nowrap;
      pointer-events: none;
      z-index: 2147483647;
      backdrop-filter: blur(4px);
      display: none;
    `

    document.body.appendChild(this.cursorElement)
    document.body.appendChild(this.statusHud)
    this.buildSVG()
  }

  showStatus(text) {
    if (!this.statusHud) return
    this.statusHud.textContent = text
    this.statusHud.style.display = 'block'
  }

  hideStatus() {
    if (this.statusHud) {
      this.statusHud.style.display = 'none'
    }
  }

  buildSVG() {
    if (!this.svgElement) return

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient')
    gradient.setAttribute('id', 'cursorGradient')
    gradient.setAttribute('cx', '50%')
    gradient.setAttribute('cy', '50%')
    gradient.setAttribute('r', '50%')

    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop')
    stop1.setAttribute('offset', '0%')
    stop1.setAttribute('stop-color', '#4ecdc4')
    stop1.setAttribute('stop-opacity', '0.9')

    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop')
    stop2.setAttribute('offset', '70%')
    stop2.setAttribute('stop-color', '#4ecdc4')
    stop2.setAttribute('stop-opacity', '0.6')

    const stop3 = document.createElementNS('http://www.w3.org/2000/svg', 'stop')
    stop3.setAttribute('offset', '100%')
    stop3.setAttribute('stop-color', '#4ecdc4')
    stop3.setAttribute('stop-opacity', '0.2')

    gradient.appendChild(stop1)
    gradient.appendChild(stop2)
    gradient.appendChild(stop3)

    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter')
    filter.setAttribute('id', 'cursorGlow')
    filter.setAttribute('x', '-50%')
    filter.setAttribute('y', '-50%')
    filter.setAttribute('width', '200%')
    filter.setAttribute('height', '200%')

    const feGaussianBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur')
    feGaussianBlur.setAttribute('stdDeviation', '2')
    feGaussianBlur.setAttribute('result', 'blur')

    const feMerge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge')
    const feMergeNode1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode')
    feMergeNode1.setAttribute('in', 'blur')
    const feMergeNode2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode')
    feMergeNode2.setAttribute('in', 'SourceGraphic')

    feMerge.appendChild(feMergeNode1)
    feMerge.appendChild(feMergeNode2)
    filter.appendChild(feGaussianBlur)
    filter.appendChild(feMerge)

    defs.appendChild(gradient)
    defs.appendChild(filter)
    this.svgElement.appendChild(defs)

    const mainCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    mainCircle.setAttribute('cx', '12')
    mainCircle.setAttribute('cy', '12')
    mainCircle.setAttribute('r', '10')
    mainCircle.setAttribute('fill', 'url(#cursorGradient)')
    mainCircle.setAttribute('filter', 'url(#cursorGlow)')
    mainCircle.setAttribute('stroke', '#4ecdc4')
    mainCircle.setAttribute('stroke-width', '1.5')
    mainCircle.setAttribute('stroke-opacity', '0.5')
    this.svgElement.appendChild(mainCircle)

    const centerDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    centerDot.setAttribute('cx', '12')
    centerDot.setAttribute('cy', '12')
    centerDot.setAttribute('r', '3')
    centerDot.setAttribute('fill', 'white')
    centerDot.setAttribute('opacity', '0.8')
    this.svgElement.appendChild(centerDot)

    const hoverRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    hoverRing.setAttribute('cx', '12')
    hoverRing.setAttribute('cy', '12')
    hoverRing.setAttribute('r', '14')
    hoverRing.setAttribute('fill', 'none')
    hoverRing.setAttribute('stroke', '#4ecdc4')
    hoverRing.setAttribute('stroke-width', '1.5')
    hoverRing.setAttribute('stroke-opacity', '0.6')
    hoverRing.setAttribute('stroke-dasharray', '4 4')
    hoverRing.setAttribute('display', 'none')
    hoverRing.id = 'hoverRing'
    this.svgElement.appendChild(hoverRing)

    const dwellRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    dwellRing.setAttribute('cx', String(DWELL_RING_SIZE / 2))
    dwellRing.setAttribute('cy', String(DWELL_RING_SIZE / 2))
    dwellRing.setAttribute('r', String(DWELL_RING_SIZE / 2 - 3))
    dwellRing.setAttribute('fill', 'none')
    dwellRing.setAttribute('stroke', '#4ecdc4')
    dwellRing.setAttribute('stroke-width', '3')
    dwellRing.setAttribute('stroke-linecap', 'round')
    dwellRing.setAttribute('transform', `rotate(-90 ${DWELL_RING_SIZE / 2} ${DWELL_RING_SIZE / 2})`)
    dwellRing.style.transition = 'stroke-dasharray 50ms linear'
    this.dwellRingElement?.appendChild(dwellRing)
  }

  updatePosition(position) {
    if (!position || !this.cursorElement) {
      this.hide()
      return
    }

    this.currentPosition = position
    this.cursorElement.style.display = 'block'
    this.cursorElement.style.left = `${position.x - CURSOR_SIZE / 2}px`
    this.cursorElement.style.top = `${position.y - CURSOR_SIZE / 2}px`
  }

  updateTarget(target) {
    this.targetElement = target
    const isOverTarget = target !== null

    if (!this.cursorElement || !this.svgElement) return

    const cursorColor = isOverTarget ? '#ff6b6b' : this.mode === 'face' ? '#4ecdc4' : '#ffe66d'

    const gradient = this.svgElement.querySelector('#cursorGradient')
    if (gradient) {
      const stops = gradient.querySelectorAll('stop')
      stops[0].setAttribute('stop-color', cursorColor)
      stops[1].setAttribute('stop-color', cursorColor)
      stops[2].setAttribute('stop-color', cursorColor)
    }

    const mainCircle = this.svgElement.querySelector('circle')
    if (mainCircle) {
      mainCircle.setAttribute('stroke', cursorColor)
    }

    const hoverRing = this.svgElement.querySelector('#hoverRing')
    if (hoverRing) {
      hoverRing.setAttribute('display', isOverTarget ? 'block' : 'none')
      hoverRing.setAttribute('stroke', cursorColor)
    }

    const dwellCircle = this.dwellRingElement?.querySelector('circle')
    if (dwellCircle) {
      dwellCircle.setAttribute('stroke', '#4ecdc4')
    }

    if (target) {
      this.labelElement.style.display = 'block'
      this.labelElement.textContent = `${target.tagName.toUpperCase()}${target.type ? `[${target.type}]` : ''}${target.isLink ? ' → Link' : ''}`
      this.labelElement.style.left = `${target.center.x - this.currentPosition.x}px`
      this.labelElement.style.top = `${target.center.y - this.currentPosition.y}px`
    } else {
      this.labelElement.style.display = 'none'
    }
  }

  setMode(mode) {
    this.mode = mode
  }

  setMagneticParams(radius, strength) {
    this.magneticRadius = radius
    this.snapStrength = strength
  }

  setDwellTime(ms) {
    this.dwellTime = ms
  }

  startDwell(target, onComplete) {
    this.isDwelling = true
    this.dwellProgress = 0
    this.dwellStartTime = Date.now()
    this.onDwellCompleteCallback = onComplete
    this.targetElement = target

    if (this.dwellRingElement) {
      this.dwellRingElement.style.display = 'block'
    }

    this.animateDwell()
  }

  animateDwell() {
    if (!this.isDwelling) return

    const elapsed = Date.now() - this.dwellStartTime
    this.dwellProgress = Math.min(elapsed / this.dwellTime, 1)

    const circumference = (DWELL_RING_SIZE - 6) * Math.PI * 2
    const dashArray = `${circumference * this.dwellProgress} ${circumference}`

    const dwellCircle = this.dwellRingElement?.querySelector('circle')
    if (dwellCircle) {
      dwellCircle.setAttribute('stroke-dasharray', dashArray)
    }

    if (this.dwellProgress >= 1) {
      this.completeDwell()
      return
    }

    this.animationId = requestAnimationFrame(() => this.animateDwell())
  }

  completeDwell() {
    this.isDwelling = false
    this.dwellProgress = 0

    if (this.dwellRingElement) {
      this.dwellRingElement.style.display = 'none'
    }

    if (this.onDwellCompleteCallback && this.targetElement) {
      this.onDwellCompleteCallback(this.targetElement)
    }

    this.onDwellCompleteCallback = null
    this.targetElement = null
  }

  cancelDwell() {
    this.isDwelling = false
    this.dwellProgress = 0

    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }

    if (this.dwellRingElement) {
      this.dwellRingElement.style.display = 'none'
    }

    this.onDwellCompleteCallback = null
    this.targetElement = null
  }

  show() {
    if (this.cursorElement) {
      this.cursorElement.style.display = 'block'
    }
  }

  flashClick() {
    if (!this.cursorElement) return
    const el = this.cursorElement
    el.style.transformOrigin = 'center'
    el.style.transition = 'transform 60ms ease-out'
    el.style.transform = 'scale(1.45)'
    window.setTimeout(() => {
      if (!this.cursorElement) return
      this.cursorElement.style.transition = 'transform 140ms ease-in'
      this.cursorElement.style.transform = 'scale(1)'
    }, 60)
  }

  hide() {
    if (this.cursorElement) {
      this.cursorElement.style.display = 'none'
    }
    this.cancelDwell()
  }

  destroy() {
    this.cancelDwell()
    this.cursorElement?.remove()
    this.cursorElement = null
    this.svgElement = null
    this.dwellRingElement = null
    this.labelElement = null
    this.statusHud?.remove()
    this.statusHud = null
  }
}
