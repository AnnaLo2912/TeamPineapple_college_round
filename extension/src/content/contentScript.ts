import type { TrackerConfig, Point, ClickableElement, TrackingMode, ExtensionMessage } from '../shared/types'
import { DEFAULT_CONFIG, DWELL_TIME, CLICK_COOLDOWN } from '../shared/types'
import {
  CALIBRATION_POINTS,
  DWELL_DETECT_RADIUS,
  DWELL_EDGE_MARGIN,
  EDGE_SCROLL_HOLD_MS,
  NUDGE_ACCEL_MS,
  NUDGE_MAX_SPEED,
  SCROLL_ACCEL_MS,
  SCROLL_MIN_SPEED,
  SCROLL_MAX_SPEED,
} from '../shared/constants'
import { CoordinateMapper } from './tracker/CoordinateMapper'
import { CursorOverlay } from './overlay/CursorOverlay'
import { TargetHighlighter } from './overlay/TargetHighlighter'
import { CalibrationOverlay } from './overlay/CalibrationOverlay'
import { TabDock, type NudgeDirection, type TabDirection } from './overlay/TabDock'
import { calibrationManager } from './calibration/CalibrationManager'
import { targetDetector } from './overlay/TargetDetector'
import {
  dispatchHover,
  dispatchClickSequence,
  dispatchDragStart,
  dispatchDragMove,
  dispatchDragEnd,
  isSliderLike,
} from './interaction/PointerInteractor'
import { messagingBridge, loadConfig, saveConfig, getCalibration, saveCalibration } from './messaging/MessagingBridge'
import { debugLog, debugEvery } from '../shared/debug'

let config: TrackerConfig = DEFAULT_CONFIG
let coordinateMapper: CoordinateMapper | null = null
let cursorOverlay: CursorOverlay | null = null
let targetHighlighter: TargetHighlighter | null = null
let calibrationOverlay: CalibrationOverlay | null = null
let tabDock: TabDock | null = null
let lastClickTime = 0
let currentDwellTarget: ClickableElement | null = null
let lastRawPoint: Point | null = null
let lastSnappedPoint: Point | null = null
let lastDrawnPoint: Point | null = null
let trackingEnabled = true

let edgeScrollState: { dir: -1 | 1; holdingSince: number } | null = null

let nudgeActive = false
let nudgeDecelerating = false
let nudgeDir: NudgeDirection = 'right'
let nudgeOffset: Point = { x: 0, y: 0 }
let nudgeSpeed = 0
let nudgeStart = 0
let nudgeFrame: number | null = null

let scrollActive = false
let scrollDir: -1 | 1 = 1
let scrollSpeed = 0
let scrollStart = 0
let scrollFrame: number | null = null

let dragActive = false
let dragTarget: ClickableElement | null = null
let dragFrame: number | null = null
let dragElement: Element | null = null

let lastHoverTime = 0

let calibrationTargetIndex = -1
let calibrationDwellStart = 0

function initOverlay() {
  cursorOverlay = new CursorOverlay(config.magneticRadius, config.snapStrength)
  targetHighlighter = new TargetHighlighter()
  calibrationOverlay = new CalibrationOverlay()
  tabDock = new TabDock({
    onNudge: (dir) => startNudge(dir),
    onStop: () => {
      stopScrollDrive()
      stopNudge()
    },
    onScroll: (dir) => {
      stopNudge()
      toggleScrollDrive(dir)
    },
    onRecenter: () => {
      stopScrollDrive()
      stopNudge()
      handleRecenter()
    },
    onTab: (dir) => {
      stopScrollDrive()
      stopNudge()
      sendTabCommand(dir)
    },
  })
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
    // The on-page webcam preview is no longer supported: the camera now lives
    // in the offscreen document. Clear the flag so the UI stays consistent.
    config.showWebcamPreview = false
    await saveConfig(config)
  }

  tabDock?.show()

  // Register this tab with the background so it receives tracking results.
  chrome.runtime.sendMessage({ type: 'TAB_REGISTER' }, () => void chrome.runtime.lastError)
  debugLog('content', 'TAB_REGISTER sent')
}

function setupMessageHandlers() {
  messagingBridge.onMessage('TRACKING_RESULT', (message: ExtensionMessage) => {
    if (message.type === 'TRACKING_RESULT') {
      handleTrackingResult(message.rawPoint, message.confidence)
    }
  })

  messagingBridge.onMessage('TOGGLE_TRACKING', (message: ExtensionMessage) => {
    if (message.type === 'TOGGLE_TRACKING') {
      setEnabled(message.enabled)
      sendStatusUpdate()
    }
  })

  messagingBridge.onMessage('RECENTER', () => {
    handleRecenter()
    sendStatusUpdate()
  })

  messagingBridge.onMessage('SET_MODE', (message: ExtensionMessage) => {
    if (message.type === 'SET_MODE') {
      void setMode(message.mode)
    }
  })

  messagingBridge.onMessage('CONFIG_UPDATE', (message: ExtensionMessage) => {
    if (message.type === 'CONFIG_UPDATE') {
      void updateConfig(message.config)
      sendStatusUpdate()
    }
  })

  messagingBridge.onMessage('START_CALIBRATION', (message: ExtensionMessage) => {
    if (message.type === 'START_CALIBRATION') {
      void startCalibration(message.mode)
    }
  })

  messagingBridge.onMessage('CLEAR_CALIBRATION', (message: ExtensionMessage) => {
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

function handleTrackingResult(rawPoint: Point | null, _confidence: number) {
  debugEvery('content:result', 15, 'received', { hasPoint: rawPoint !== null })

  if (!rawPoint || !coordinateMapper) {
    cursorOverlay?.updatePosition(null)
    targetHighlighter?.updateTarget(null)
    cancelDwell()
    stopScrollDrive()
    pauseNudge()
    return
  }

  lastRawPoint = rawPoint

  const smoothed = coordinateMapper.smoothPoint(rawPoint)
  const mappedPoint = coordinateMapper.mapPoint(smoothed)
  debugEvery('content:mapped', 15, 'mapped', { x: Math.round(mappedPoint.x), y: Math.round(mappedPoint.y) })

  const snappedPosition =
    targetDetector.applyMagneticSnap(mappedPoint.x, mappedPoint.y, config.magneticRadius, config.snapStrength) ||
    mappedPoint

  lastSnappedPoint = snappedPosition

  if (config.isCalibrating) {
    updateCalibration(mappedPoint)
    return
  }

  if (nudgeActive || nudgeDecelerating) {
    cancelDwell()
    renderNudgeCursor()
    targetHighlighter?.updateTarget(null)
    return
  }

  if (scrollActive) {
    cancelDwell()
    cursorOverlay?.updatePosition(snappedPosition)
    cursorOverlay?.updateTarget(null)
    targetHighlighter?.updateTarget(null)
    return
  }

  updateInteraction(snappedPosition, mappedPoint)
}

function updateInteraction(snappedPosition: Point, mappedPoint: Point) {
  const target = targetDetector.getTargetAtPoint(snappedPosition.x, snappedPosition.y, DWELL_DETECT_RADIUS)

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

  if (cursorOverlay) {
    cursorOverlay.updatePosition(snappedPosition)
    cursorOverlay.updateTarget(target)
    cursorOverlay.setMagneticParams(config.magneticRadius, config.snapStrength)
  }

  targetHighlighter?.updateTarget(target)

  pulseHover(snappedPosition)
  updateEdgeScroll(mappedPoint, target)
}

function pulseHover(position: Point) {
  const now = Date.now()
  if (now - lastHoverTime < 90) return
  lastHoverTime = now
  dispatchHover(position.x, position.y)
}

function renderNudgeCursor() {
  if (!lastSnappedPoint) return
  const position = clampToViewport({
    x: lastSnappedPoint.x + nudgeOffset.x,
    y: lastSnappedPoint.y + nudgeOffset.y,
  })
  lastDrawnPoint = position
  cursorOverlay?.updatePosition(position)
}

function clampToViewport(point: Point): Point {
  return {
    x: Math.max(2, Math.min(window.innerWidth - 2, point.x)),
    y: Math.max(2, Math.min(window.innerHeight - 2, point.y)),
  }
}

function sameLogicalTarget(a: ClickableElement, b: ClickableElement): boolean {
  return (
    a.element === b.element ||
    b.element.contains(a.element) ||
    a.element.contains(b.element)
  )
}

function isNearTarget(target: ClickableElement, point: Point, margin: number): boolean {
  const r = target.rect
  return (
    point.x >= r.left - margin &&
    point.x <= r.right + margin &&
    point.y >= r.top - margin &&
    point.y <= r.bottom + margin
  )
}

function updateCalibration(mappedPoint: Point) {
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

  cursorOverlay?.updatePosition(mappedPoint)
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

function startDwell(target: ClickableElement) {
  currentDwellTarget = target
  cursorOverlay?.setDwellTime(config.dwellTime)

  const slider = isSliderLike(target.element)
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

function executeClick(target: ClickableElement) {
  const now = Date.now()
  if (now - lastClickTime < CLICK_COOLDOWN) return
  lastClickTime = now

  if (!target.element.isConnected) return

  debugLog('content', 'dwell:click', { tagName: target.tagName })
  cursorOverlay?.flashClick()

  const point = lastDrawnPoint || target.center
  dispatchClickSequence(target.element, point.x, point.y)
  const element = target.element as HTMLElement
  element.focus?.()
}

function startDrag(target: ClickableElement) {
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

function nudgeVector(dir: NudgeDirection): Point {
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

function clampOffset(x: number, y: number): Point {
  const s = lastSnappedPoint
  if (!s) return { x, y }
  return {
    x: Math.max(2 - s.x, Math.min(window.innerWidth - 2 - s.x, x)),
    y: Math.max(2 - s.y, Math.min(window.innerHeight - 2 - s.y, y)),
  }
}

function startNudge(dir: NudgeDirection) {
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
    const target = Math.min(elapsed / NUDGE_ACCEL_MS, 1) * NUDGE_MAX_SPEED
    nudgeSpeed += (target - nudgeSpeed) * 0.3
  } else {
    nudgeSpeed *= 0.8
    if (nudgeSpeed < 0.3) {
      nudgeSpeed = 0
      nudgeDecelerating = false
      nudgeFrame = null
      cursorOverlay?.hideStatus()
      renderNudgeCursor()
      return
    }
  }

  const v = nudgeVector(nudgeDir)
  nudgeOffset = clampOffset(nudgeOffset.x + v.x * nudgeSpeed, nudgeOffset.y + v.y * nudgeSpeed)
  renderNudgeCursor()
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

function startScrollDrive(dir: -1 | 1) {
  if (config.isCalibrating) return
  scrollActive = true
  scrollDir = dir
  scrollSpeed = SCROLL_MIN_SPEED
  scrollStart = Date.now()
  cancelDwell()
  debugLog('content', 'scroll:start', { dir })
  cursorOverlay?.showStatus(dir < 0 ? '⇈ Scrolling up' : '⇊ Scrolling down')
  if (scrollFrame === null) {
    scrollFrame = requestAnimationFrame(scrollTick)
  }
}

function toggleScrollDrive(dir: -1 | 1) {
  if (scrollActive && scrollDir === dir) {
    stopScrollDrive()
    return
  }
  startScrollDrive(dir)
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

function stopScrollDrive() {
  if (!scrollActive) return
  scrollActive = false
  if (scrollFrame !== null) {
    cancelAnimationFrame(scrollFrame)
    scrollFrame = null
  }
  cursorOverlay?.hideStatus()
  debugLog('content', 'scroll:stop')
}

function sendTabCommand(dir: TabDirection) {
  const type = dir < 0 ? 'CMD_PREV_TAB' : 'CMD_NEXT_TAB'
  chrome.runtime.sendMessage({ type, timestamp: Date.now() }, () => void chrome.runtime.lastError)
  debugLog('content', 'tab:switch', { dir })
}

function updateEdgeScroll(mappedPoint: Point, target: ClickableElement | null) {
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
  let dir: -1 | 1 | 0 = 0
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
    startScrollDrive(dir)
  }
}

function setEnabled(enabled: boolean) {
  trackingEnabled = enabled
  if (!enabled) {
    cancelDwell()
    stopScrollDrive()
    resetNudge()
    cursorOverlay?.hide()
    targetHighlighter?.hide()
    tabDock?.hide()
  } else {
    tabDock?.show()
  }
}

function handleRecenter() {
  if (!lastRawPoint || !coordinateMapper) return

  const recentered = calibrationManager.recenter(lastRawPoint, config.mode)
  if (recentered) {
    coordinateMapper.setCalibration(recentered)
  } else {
    coordinateMapper.recenterDirect(lastRawPoint)
  }
  nudgeOffset = { x: 0, y: 0 }
  nudgeSpeed = 0
  debugLog('content', 'recenter', { mode: config.mode, calibrated: !!recentered })
  sendStatusUpdate()
}

async function setMode(mode: TrackingMode) {
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

async function updateConfig(updates: Partial<TrackerConfig>) {
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

async function startCalibration(mode: TrackingMode) {
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

async function clearCalibration(mode: TrackingMode) {
  calibrationManager.clearCalibration(mode)
  await chrome.storage.sync.remove(mode === 'face' ? 'handsfree_calibration_face' : 'handsfree_calibration_hand')
  coordinateMapper?.clearCalibration()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initOverlay()
    void init()
  })
} else {
  initOverlay()
  void init()
}

export {}
