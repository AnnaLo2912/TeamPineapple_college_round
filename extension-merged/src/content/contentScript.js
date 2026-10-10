import { DEFAULT_CONFIG, DWELL_TIME, CLICK_COOLDOWN } from '../shared/types.js'
import {
  CALIBRATION_POINTS,
  DWELL_DETECT_RADIUS,
  DWELL_EDGE_MARGIN,
  DOCK_DWELL_MS,
  EDGE_SCROLL_HOLD_MS,
  NUDGE_ACCEL_MS,
  NUDGE_MAX_SPEED,
  SCROLL_ACCEL_MS,
  SCROLL_MIN_SPEED,
  SCROLL_MAX_SPEED,
} from '../shared/constants.js'
import { CoordinateMapper } from './tracker/CoordinateMapper.js'
import { CursorOverlay } from './overlay/CursorOverlay.js'
import { TargetHighlighter } from './overlay/TargetHighlighter.js'
import { CalibrationOverlay } from './overlay/CalibrationOverlay.js'
import { TabDock } from './overlay/TabDock.js'
import { calibrationManager } from './calibration/CalibrationManager.js'
import { targetDetector } from './overlay/TargetDetector.js'
import {
  dispatchHover,
  resetHover,
  dispatchClickSequence,
  dispatchDragStart,
  dispatchDragMove,
  dispatchDragEnd,
  isSliderLike,
} from './interaction/PointerInteractor.js'
import { messagingBridge, loadConfig, saveConfig, getCalibration, saveCalibration } from './messaging/MessagingBridge.js'
import { debugLog, debugEvery } from '../shared/debug.js'

let config = DEFAULT_CONFIG
let coordinateMapper = null
let cursorOverlay = null
let targetHighlighter = null
let calibrationOverlay = null
let tabDock = null
let lastClickTime = 0
let currentDwellTarget = null
let lastRawPoint = null
let lastMappedPoint = null
let lastSnappedPoint = null
let lastDrawnPoint = null
let trackingEnabled = true

let edgeScrollState = null

let nudgeActive = false
let nudgeDecelerating = false
let nudgeDir = 'right'
let nudgeOffset = { x: 0, y: 0 }
let nudgeSpeed = 0
let nudgeStart = 0
let nudgeFrame = null

let scrollActive = false
let scrollDir = 1
let scrollSpeed = 0
let scrollStart = 0
let scrollFrame = null
let scrollSource = null

let dragActive = false
let dragTarget = null
let dragFrame = null
let dragElement = null

let lastHoverTime = 0
let dockCooldownUntil = 0

let recenterDeadline = 0

let renderTarget = null
let renderCurrent = null
let renderFrame = null

let calibrationTargetIndex = -1
let calibrationDwellStart = 0

function initOverlay() {
  cursorOverlay = new CursorOverlay(config.magneticRadius, config.snapStrength)
  targetHighlighter = new TargetHighlighter()
  calibrationOverlay = new CalibrationOverlay()
  tabDock = new TabDock({
    onNudge: (dir) => {
      triggerDockCooldown()
      startNudge(dir)
    },
    onStop: () => {
      triggerDockCooldown()
      cancelRecenter()
      stopScrollDrive()
      stopNudge()
    },
    onScroll: (dir, element) => {
      triggerDockCooldown()
      cancelRecenter()
      stopNudge()
      toggleScrollDrive(dir, element)
    },
    onRecenter: () => {
      triggerDockCooldown()
      stopScrollDrive()
      stopNudge()
      handleRecenter()
    },
    onTab: (dir) => {
      triggerDockCooldown()
      cancelRecenter()
      stopScrollDrive()
      stopNudge()
      sendTabCommand(dir)
    },
  })
}

function triggerDockCooldown() {
  dockCooldownUntil = Date.now() + 550
}

async function init() {
  config = await loadConfig()
  coordinateMapper = new CoordinateMapper(config)
  debugLog('content', 'init', { mode: config.mode, mapper: !!coordinateMapper })

  cursorOverlay?.setMode(config.mode)
  cursorOverlay?.setDwellTime(config.dwellTime)

  const savedCal = await getCalibration(config.mode)
  if (savedCal) {
    coordinateMapper.setCalibration(savedCal)
  }

  setupMessageHandlers()

  if (config.showWebcamPreview) {
    config.showWebcamPreview = false
    await saveConfig(config)
  }

  tabDock?.show()

  chrome.runtime.sendMessage({ type: 'TAB_REGISTER' }, () => void chrome.runtime.lastError)
  debugLog('content', 'TAB_REGISTER sent')
}

function setupMessageHandlers() {
  messagingBridge.onMessage('TRACKING_RESULT', (message) => {
    if (message.type === 'TRACKING_RESULT') {
      handleTrackingResult(message.rawPoint, message.confidence)
    }
  })

  messagingBridge.onMessage('TOGGLE_TRACKING', (message) => {
    if (message.type === 'TOGGLE_TRACKING') {
      setEnabled(message.enabled)
      sendStatusUpdate()
    }
  })

  messagingBridge.onMessage('MODULE_STATE', (message) => {
    if (message.type === 'MODULE_STATE') {
      setEnabled(!!message.headhands)
      sendStatusUpdate()
    }
  })

  messagingBridge.onMessage('RECENTER', () => {
    handleRecenter()
    sendStatusUpdate()
  })

  messagingBridge.onMessage('SET_MODE', (message) => {
    if (message.type === 'SET_MODE') {
      void setMode(message.mode)
    }
  })

  messagingBridge.onMessage('CONFIG_UPDATE', (message) => {
    if (message.type === 'CONFIG_UPDATE') {
      void updateConfig(message.config)
      sendStatusUpdate()
    }
  })

  messagingBridge.onMessage('START_CALIBRATION', (message) => {
    if (message.type === 'START_CALIBRATION') {
      void startCalibration(message.mode)
    }
  })

  messagingBridge.onMessage('CLEAR_CALIBRATION', (message) => {
    if (message.type === 'CLEAR_CALIBRATION') {
      void clearCalibration(message.mode)
      sendStatusUpdate()
    }
  })
}

function sendStatusUpdate() {
  chrome.runtime.sendMessage({
    type: 'STATUS_UPDATE',
    enabled: trackingEnabled,
    mode: config.mode,
    isCalibrating: config.isCalibrating,
  })
}

function handleTrackingResult(rawPoint, _confidence) {
  debugEvery('content:result', 15, 'received', { hasPoint: rawPoint !== null })

  if (!rawPoint || !coordinateMapper) {
    setCursorTarget(null)
    targetHighlighter?.updateTarget(null)
    cancelDwell()
    stopScrollDrive()
    pauseNudge()
    return
  }

  lastRawPoint = rawPoint

  if (recenterDeadline > 0) {
    const remaining = recenterDeadline - Date.now()
    if (remaining <= 0) {
      applyRecenter()
    } else {
      cursorOverlay?.showStatus(`Recenter in ${(remaining / 1000).toFixed(1)}s — look forward`)
    }
  }

  const smoothed = coordinateMapper.smoothPoint(rawPoint)
  const mappedPoint = coordinateMapper.mapPoint(smoothed)
  lastMappedPoint = mappedPoint
  debugEvery('content:mapped', 15, 'mapped', { x: Math.round(mappedPoint.x), y: Math.round(mappedPoint.y) })

  const snapping = !nudgeActive && !nudgeDecelerating && !scrollActive
  const rawCursor = clampToViewport({
    x: mappedPoint.x + nudgeOffset.x,
    y: mappedPoint.y + nudgeOffset.y,
  })
  const overDock = tabDock?.isOverDock(rawCursor.x, rawCursor.y) ?? false
  const snappedPosition =
    (snapping && !overDock
      ? targetDetector.applyMagneticSnap(rawCursor.x, rawCursor.y, config.magneticRadius, config.snapStrength)
      : null) || rawCursor

  lastSnappedPoint = snappedPosition

  if (config.isCalibrating) {
    setCursorTarget(mappedPoint)
    updateCalibration(mappedPoint)
    return
  }

  updateInteraction(snappedPosition, mappedPoint)
}

function buildDockTarget(hit) {
  const rect = hit.rect
  return {
    element: hit.element,
    rect,
    center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    tagName: 'button',
    type: 'button',
    isInput: false,
    isLink: false,
    isButton: true,
  }
}

function resolveTarget(position) {
  const overDock = tabDock?.isOverDock(position.x, position.y) ?? false
  if (overDock) {
    if (Date.now() < dockCooldownUntil) return null
    const dockHit = tabDock?.hitTest(position.x, position.y) ?? null
    if (!dockHit) return null
    if (
      scrollActive &&
      scrollSource?.kind === 'element' &&
      scrollSource.element === dockHit.element
    ) {
      return null
    }
    return buildDockTarget(dockHit)
  }
  if (nudgeActive || nudgeDecelerating || scrollActive) {
    return null
  }
  return targetDetector.getTargetAtPoint(position.x, position.y, DWELL_DETECT_RADIUS)
}

function isDockTarget(target) {
  return Boolean(target.element.closest?.('.handsfree-tab-dock'))
}

function updateInteraction(snappedPosition, mappedPoint) {
  const target = resolveTarget(snappedPosition)

  if (currentDwellTarget) {
    const keepDwelling =
      isNearTarget(currentDwellTarget, snappedPosition, DWELL_EDGE_MARGIN) ||
      (target !== null && sameLogicalTarget(target, currentDwellTarget))

    if (!keepDwelling) {
      cancelDwell()
      if (target) {
        startDwell(target)
      }
    }
  } else if (target) {
    startDwell(target)
  }

  lastDrawnPoint = snappedPosition
  setCursorTarget(snappedPosition)

  if (cursorOverlay) {
    cursorOverlay.updateTarget(target)
    cursorOverlay.setMagneticParams(config.magneticRadius, config.snapStrength)
  }

  targetHighlighter?.updateTarget(target)

  if (!nudgeActive && !nudgeDecelerating && !scrollActive) {
    pulseHover(snappedPosition)
  }

  checkScrollLeave()
  updateEdgeScroll(mappedPoint, target)
}

function pulseHover(position) {
  const now = Date.now()
  if (now - lastHoverTime < 90) return
  lastHoverTime = now
  dispatchHover(position.x, position.y)
}

function setCursorTarget(point) {
  if (!point) {
    renderTarget = null
    renderCurrent = null
    if (renderFrame !== null) {
      cancelAnimationFrame(renderFrame)
      renderFrame = null
    }
    cursorOverlay?.updatePosition(null)
    resetHover()
    return
  }
  renderTarget = point
  if (renderCurrent === null) {
    renderCurrent = { ...point }
    cursorOverlay?.updatePosition(renderCurrent)
  }
  if (renderFrame === null) {
    renderFrame = requestAnimationFrame(renderTick)
  }
}

function renderTick() {
  renderFrame = null
  if (!renderTarget || !renderCurrent) return

  renderCurrent.x += (renderTarget.x - renderCurrent.x) * 0.35
  renderCurrent.y += (renderTarget.y - renderCurrent.y) * 0.35
  lastDrawnPoint = renderCurrent
  cursorOverlay?.updatePosition(renderCurrent)

  const dx = Math.abs(renderTarget.x - renderCurrent.x)
  const dy = Math.abs(renderTarget.y - renderCurrent.y)
  if (dx < 0.4 && dy < 0.4) {
    renderCurrent = { ...renderTarget }
    lastDrawnPoint = renderCurrent
    cursorOverlay?.updatePosition(renderCurrent)
    return
  }
  renderFrame = requestAnimationFrame(renderTick)
}

function clampToViewport(point) {
  return {
    x: Math.max(2, Math.min(window.innerWidth - 2, point.x)),
    y: Math.max(2, Math.min(window.innerHeight - 2, point.y)),
  }
}

function sameLogicalTarget(a, b) {
  return (
    a.element === b.element ||
    b.element.contains(a.element) ||
    a.element.contains(b.element)
  )
}

function isNearTarget(target, point, margin) {
  const r = target.rect
  return (
    point.x >= r.left - margin &&
    point.x <= r.right + margin &&
    point.y >= r.top - margin &&
    point.y <= r.bottom + margin
  )
}

function updateCalibration(mappedPoint) {
  const calibrationPoint = CALIBRATION_POINTS[calibrationTargetIndex]
  if (!calibrationPoint) return

  const targetX = calibrationPoint.x * window.innerWidth
  const targetY = calibrationPoint.y * window.innerHeight
  const dist = Math.hypot(mappedPoint.x - targetX, mappedPoint.y - targetY)
  const onTarget = dist < 70

  if (onTarget) {
    if (calibrationDwellStart === 0) calibrationDwellStart = Date.now()
    if (Date.now() - calibrationDwellStart >= DWELL_TIME) {
      captureCalibrationPoint()
    }
  } else {
    calibrationDwellStart = 0
  }

  cursorOverlay?.updateTarget(null)
  targetHighlighter?.updateTarget(null)
}

function captureCalibrationPoint() {
  calibrationDwellStart = 0
  if (!lastRawPoint) return

  const result = calibrationManager.addCalibrationPoint(lastRawPoint)
  if (result.done) {
    calibrationOverlay?.complete()
  } else if (result.progress) {
    calibrationTargetIndex = Math.max(0, (result.progress.current || 1) - 1)
    calibrationOverlay?.setCurrentPointIndex(calibrationTargetIndex)
  }
}

function startDwell(target) {
  currentDwellTarget = target
  const dock = isDockTarget(target)
  cursorOverlay?.setDwellTime(dock ? DOCK_DWELL_MS : config.dwellTime)

  const slider = !dock && isSliderLike(target.element)
  if (slider) {
    startDrag(target)
  }

  cursorOverlay?.startDwell(target, (element) => {
    currentDwellTarget = null
    if (dragActive) {
      endDrag()
    } else {
      executeClick(element)
    }
  })
  debugLog('content', 'dwell:start', { tagName: target.tagName, slider })
}

function cancelDwell() {
  currentDwellTarget = null
  cursorOverlay?.cancelDwell()
  if (dragActive) endDrag()
}

function executeClick(target) {
  const dock = isDockTarget(target)
  const now = Date.now()
  if (!dock && now - lastClickTime < CLICK_COOLDOWN) return
  lastClickTime = now

  if (!target.element.isConnected) return

  debugLog('content', 'dwell:click', { tagName: target.tagName })
  cursorOverlay?.flashClick()

  const point = lastDrawnPoint || target.center
  dispatchClickSequence(target.element, point.x, point.y)
  const element = target.element
  element.focus?.()
}

function startDrag(target) {
  dragActive = true
  dragTarget = target
  dragElement = target.element
  const point = lastDrawnPoint || target.center
  dispatchDragStart(target.element, point.x, point.y)
  debugLog('content', 'drag:start', { tagName: target.tagName })
  if (dragFrame === null) {
    dragFrame = requestAnimationFrame(dragTick)
  }
}

function dragTick() {
  if (!dragActive || !dragElement) {
    dragFrame = null
    return
  }
  const point = lastDrawnPoint
  if (point) dispatchDragMove(point.x, point.y, dragElement)
  dragFrame = requestAnimationFrame(dragTick)
}

function endDrag() {
  if (!dragActive) return
  dragActive = false
  if (dragFrame !== null) {
    cancelAnimationFrame(dragFrame)
    dragFrame = null
  }
  const point = lastDrawnPoint || dragTarget?.center || { x: 0, y: 0 }
  if (dragElement) dispatchDragEnd(dragElement, point.x, point.y)
  debugLog('content', 'drag:end')
  dragTarget = null
  dragElement = null
}

function nudgeVector(dir) {
  switch (dir) {
    case 'up':
      return { x: 0, y: -1 }
    case 'down':
      return { x: 0, y: 1 }
    case 'left':
      return { x: -1, y: 0 }
    default:
      return { x: 1, y: 0 }
  }
}

function clampOffset(x, y) {
  const m = lastMappedPoint
  if (!m) return { x, y }
  return {
    x: Math.max(2 - m.x, Math.min(window.innerWidth - 2 - m.x, x)),
    y: Math.max(2 - m.y, Math.min(window.innerHeight - 2 - m.y, y)),
  }
}

function updateNudgeCursor() {
  if (!lastMappedPoint) return
  const position = clampToViewport({
    x: lastMappedPoint.x + nudgeOffset.x,
    y: lastMappedPoint.y + nudgeOffset.y,
  })
  lastSnappedPoint = position
  setCursorTarget(position)
}

function startNudge(dir) {
  if (nudgeActive && nudgeDir === dir) {
    stopNudge()
    return
  }
  cancelRecenter()
  stopScrollDrive()
  cancelDwell()
  nudgeActive = true
  nudgeDecelerating = false
  nudgeDir = dir
  nudgeStart = Date.now()
  nudgeSpeed = 0
  debugLog('content', 'nudge:start', { dir })
  cursorOverlay?.showStatus(`Cursor ${dir}`)
  if (nudgeFrame === null) {
    nudgeFrame = requestAnimationFrame(nudgeTick)
  }
}

function nudgeTick() {
  if (!nudgeActive && !nudgeDecelerating) {
    nudgeFrame = null
    return
  }

  if (nudgeActive) {
    const elapsed = Date.now() - nudgeStart
    const maxSpeed = config.padSpeed ?? NUDGE_MAX_SPEED
    const target = Math.min(elapsed / NUDGE_ACCEL_MS, 1) * maxSpeed
    nudgeSpeed += (target - nudgeSpeed) * 0.3
  } else {
    nudgeSpeed *= 0.8
    if (nudgeSpeed < 0.3) {
      nudgeSpeed = 0
      nudgeDecelerating = false
      nudgeFrame = null
      cursorOverlay?.hideStatus()
      updateNudgeCursor()
      return
    }
  }

  const v = nudgeVector(nudgeDir)
  nudgeOffset = clampOffset(nudgeOffset.x + v.x * nudgeSpeed, nudgeOffset.y + v.y * nudgeSpeed)
  updateNudgeCursor()
  nudgeFrame = requestAnimationFrame(nudgeTick)
}

function stopNudge() {
  if (!nudgeActive) return
  nudgeActive = false
  nudgeDecelerating = true
  debugLog('content', 'nudge:stop', { dir: nudgeDir })
  if (nudgeFrame === null) {
    nudgeFrame = requestAnimationFrame(nudgeTick)
  }
}

function resetNudge() {
  if (nudgeFrame !== null) {
    cancelAnimationFrame(nudgeFrame)
    nudgeFrame = null
  }
  nudgeActive = false
  nudgeDecelerating = false
  nudgeSpeed = 0
  nudgeOffset = { x: 0, y: 0 }
  cursorOverlay?.hideStatus()
}

function pauseNudge() {
  if (nudgeFrame !== null) {
    cancelAnimationFrame(nudgeFrame)
    nudgeFrame = null
  }
  nudgeActive = false
  nudgeDecelerating = false
  cursorOverlay?.hideStatus()
}

function startScrollDrive(dir, source) {
  if (config.isCalibrating) return
  scrollActive = true
  scrollDir = dir
  scrollSource = source
  scrollSpeed = SCROLL_MIN_SPEED
  scrollStart = Date.now()
  cancelDwell()
  debugLog('content', 'scroll:start', { dir, source: source.kind })
  cursorOverlay?.showStatus(dir < 0 ? '⇈ Scrolling up' : '⇊ Scrolling down')
  if (scrollFrame === null) {
    scrollFrame = requestAnimationFrame(scrollTick)
  }
}

function toggleScrollDrive(dir, element) {
  if (scrollActive && scrollDir === dir) {
    stopScrollDrive()
    return
  }
  startScrollDrive(dir, { kind: 'element', element, dir })
}

function scrollTick() {
  if (!scrollActive) {
    scrollFrame = null
    return
  }
  const elapsed = Date.now() - scrollStart
  const target =
    SCROLL_MIN_SPEED +
    Math.min(elapsed / SCROLL_ACCEL_MS, 1) * (SCROLL_MAX_SPEED - SCROLL_MIN_SPEED)
  scrollSpeed += (target - scrollSpeed) * 0.15
  window.scrollBy({ top: scrollDir * scrollSpeed, behavior: 'auto' })
  scrollFrame = requestAnimationFrame(scrollTick)
}

function checkScrollLeave() {
  if (!scrollActive || !scrollSource) return
  const pos = lastSnappedPoint
  if (!pos) return

  if (scrollSource.kind === 'element') {
    if (!scrollSource.element.isConnected) {
      stopScrollDrive()
      return
    }
    const r = scrollSource.element.getBoundingClientRect()
    const inside = pos.x >= r.left && pos.x <= r.right && pos.y >= r.top && pos.y <= r.bottom
    if (!inside) stopScrollDrive()
  } else {
    const vh = window.innerHeight
    const band = config.edgeScrollBand
    const inBand = pos.y < vh * band || pos.y > vh * (1 - band)
    if (!inBand) stopScrollDrive()
  }
}

function stopScrollDrive() {
  if (!scrollActive) return
  scrollActive = false
  scrollSource = null
  if (scrollFrame !== null) {
    cancelAnimationFrame(scrollFrame)
    scrollFrame = null
  }
  cursorOverlay?.hideStatus()
  debugLog('content', 'scroll:stop')
}

function sendTabCommand(dir) {
  const type = dir < 0 ? 'CMD_PREV_TAB' : 'CMD_NEXT_TAB'
  chrome.runtime.sendMessage({ type, timestamp: Date.now() }, () => void chrome.runtime.lastError)
  debugLog('content', 'tab:switch', { dir })
}

function updateEdgeScroll(mappedPoint, target) {
  if (
    !config.edgeScroll ||
    config.isCalibrating ||
    nudgeActive ||
    nudgeDecelerating ||
    currentDwellTarget ||
    target
  ) {
    edgeScrollState = null
    return
  }

  if (scrollActive) return

  const vh = window.innerHeight
  let dir = 0
  if (mappedPoint.y < vh * config.edgeScrollBand) {
    dir = -1
  } else if (mappedPoint.y > vh * (1 - config.edgeScrollBand)) {
    dir = 1
  }

  if (dir === 0) {
    edgeScrollState = null
    return
  }

  if (!edgeScrollState || edgeScrollState.dir !== dir) {
    edgeScrollState = { dir, holdingSince: Date.now() }
    return
  }

  if (Date.now() - edgeScrollState.holdingSince >= EDGE_SCROLL_HOLD_MS) {
    startScrollDrive(dir, { kind: 'edge', dir })
  }
}

function setEnabled(enabled) {
  trackingEnabled = enabled
  if (!enabled) {
    cancelDwell()
    cancelRecenter()
    stopScrollDrive()
    resetNudge()
    setCursorTarget(null)
    targetHighlighter?.hide()
    tabDock?.hide()
  } else {
    tabDock?.show()
  }
}

const RECENTER_DELAY_MS = 1800

function handleRecenter() {
  if (!coordinateMapper) return
  if (recenterDeadline > 0) {
    cancelRecenter()
    return
  }
  recenterDeadline = Date.now() + RECENTER_DELAY_MS
  cursorOverlay?.showStatus('Recenter in 1.8s — look forward')
  debugLog('content', 'recenter:pending')
}

function cancelRecenter() {
  if (recenterDeadline === 0) return
  recenterDeadline = 0
  cursorOverlay?.hideStatus()
  debugLog('content', 'recenter:cancel')
}

function applyRecenter() {
  recenterDeadline = 0
  cursorOverlay?.hideStatus()
  if (!lastRawPoint || !coordinateMapper) return

  const recentered = calibrationManager.recenter(lastRawPoint, config.mode)
  if (recentered) {
    coordinateMapper.setCalibration(recentered)
  } else {
    coordinateMapper.recenterDirect(lastRawPoint)
  }
  nudgeOffset = { x: 0, y: 0 }
  nudgeSpeed = 0
  debugLog('content', 'recenter:applied', { mode: config.mode, calibrated: !!recentered })
  sendStatusUpdate()
}

async function setMode(mode) {
  config.mode = mode
  await saveConfig(config)

  cursorOverlay?.setMode(mode)
  coordinateMapper?.resetSmoothing()
  coordinateMapper?.resetRecenter()

  const cal = await getCalibration(mode)
  if (cal && coordinateMapper) {
    coordinateMapper.setCalibration(cal)
  } else {
    coordinateMapper?.clearCalibration()
  }
}

async function updateConfig(updates) {
  updates = updates || {}
  config = { ...config, ...updates }
  await saveConfig(config)

  coordinateMapper?.setConfig(config)

  if (updates.dwellTime !== undefined) {
    cursorOverlay?.setDwellTime(config.dwellTime)
  }

  if (cursorOverlay && (updates.magneticRadius !== undefined || updates.snapStrength !== undefined)) {
    cursorOverlay.setMagneticParams(config.magneticRadius, config.snapStrength)
  }
}

async function startCalibration(mode) {
  config.mode = mode
  config.isCalibrating = true
  await saveConfig(config)

  cursorOverlay?.setMode(mode)
  coordinateMapper?.resetSmoothing()

  calibrationTargetIndex = 0
  calibrationDwellStart = 0
  calibrationOverlay?.setCurrentPointIndex(0)

  calibrationManager.startCalibration(
    mode,
    () => {},
    async (data) => {
      await saveCalibration(mode, data)
      coordinateMapper?.setCalibration(data)
      config.isCalibrating = false
      await saveConfig(config)
      calibrationOverlay?.complete()
    }
  )

  calibrationOverlay?.show(mode, cancelCalibration, () => {})
}

function cancelCalibration() {
  config.isCalibrating = false
  calibrationDwellStart = 0
  calibrationManager.cancelCalibration()
  calibrationOverlay?.cancel()
}

async function clearCalibration(mode) {
  calibrationManager.clearCalibration(mode)
  await chrome.storage.sync.remove(mode === 'face' ? 'handsfree_calibration_face' : 'handsfree_calibration_hand')
  coordinateMapper?.clearCalibration()
}

// Guard against duplicate content-script injection building overlay twice.
if (!window.__handsfreeContentInjected) {
  window.__handsfreeContentInjected = true
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initOverlay()
      void init()
    })
  } else {
    initOverlay()
    void init()
  }
}
