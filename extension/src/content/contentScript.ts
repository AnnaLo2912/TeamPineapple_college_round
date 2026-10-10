import type { TrackerConfig, Point, ClickableElement, TrackingMode, ExtensionMessage } from '../shared/types'
import { DEFAULT_CONFIG, DWELL_TIME, CLICK_COOLDOWN } from '../shared/types'
import { CALIBRATION_POINTS, DWELL_DETECT_RADIUS, DWELL_EDGE_MARGIN, EDGE_SCROLL_HOLD_MS } from '../shared/constants'
import { CoordinateMapper } from './tracker/CoordinateMapper'
import { CursorOverlay } from './overlay/CursorOverlay'
import { TargetHighlighter } from './overlay/TargetHighlighter'
import { CalibrationOverlay } from './overlay/CalibrationOverlay'
import { TabDock } from './overlay/TabDock'
import { calibrationManager } from './calibration/CalibrationManager'
import { targetDetector } from './overlay/TargetDetector'
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
let trackingEnabled = true
let edgeScrollState: { dir: -1 | 1; holdingSince: number } | null = null
let edgeScrollInterval: number | null = null

let calibrationTargetIndex = -1
let calibrationDwellStart = 0

function initOverlay() {
  cursorOverlay = new CursorOverlay(config.magneticRadius, config.snapStrength)
  targetHighlighter = new TargetHighlighter()
  calibrationOverlay = new CalibrationOverlay()
  tabDock = new TabDock()
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
    stopEdgeScroll()
    return
  }

  lastRawPoint = rawPoint

  const smoothed = coordinateMapper.smoothPoint(rawPoint)
  const mappedPoint = coordinateMapper.mapPoint(smoothed)
  debugEvery('content:mapped', 15, 'mapped', { x: Math.round(mappedPoint.x), y: Math.round(mappedPoint.y) })

  const snappedPosition =
    targetDetector.applyMagneticSnap(mappedPoint.x, mappedPoint.y, config.magneticRadius, config.snapStrength) ||
    mappedPoint

  if (config.isCalibrating) {
    updateCalibration(mappedPoint)
  } else {
    updateInteraction(snappedPosition, mappedPoint)
  }
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

  if (cursorOverlay) {
    cursorOverlay.updatePosition(snappedPosition)
    cursorOverlay.updateTarget(target)
    cursorOverlay.setMagneticParams(config.magneticRadius, config.snapStrength)
  }

  targetHighlighter?.updateTarget(target)

  updateEdgeScroll(mappedPoint, target)
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
  cursorOverlay?.startDwell(target, (element) => {
    currentDwellTarget = null
    executeClick(element)
  })
  debugLog('content', 'dwell:start', { tagName: target.tagName })
}

function cancelDwell() {
  currentDwellTarget = null
  cursorOverlay?.cancelDwell()
}

function executeClick(target: ClickableElement) {
  const now = Date.now()
  if (now - lastClickTime < CLICK_COOLDOWN) return
  lastClickTime = now

  if (!target.element.isConnected) return

  debugLog('content', 'dwell:click', { tagName: target.tagName })
  cursorOverlay?.flashClick()

  const element = target.element as HTMLElement
  element.click()
  element.focus()
}

function updateEdgeScroll(mappedPoint: Point, target: ClickableElement | null) {
  if (!config.edgeScroll || config.isCalibrating || currentDwellTarget || target) {
    stopEdgeScroll()
    return
  }

  const vh = window.innerHeight
  let dir: -1 | 1 | 0 = 0
  if (mappedPoint.y < vh * config.edgeScrollBand) {
    dir = -1
  } else if (mappedPoint.y > vh * (1 - config.edgeScrollBand)) {
    dir = 1
  }

  if (dir === 0) {
    stopEdgeScroll()
    return
  }

  if (!edgeScrollState) {
    edgeScrollState = { dir, holdingSince: Date.now() }
  } else if (edgeScrollState.dir !== dir) {
    edgeScrollState = { dir, holdingSince: Date.now() }
    stopEdgeScrollLoop()
  }

  if (Date.now() - edgeScrollState.holdingSince >= EDGE_SCROLL_HOLD_MS) {
    startEdgeScrollLoop(edgeScrollState.dir)
  }
}

function startEdgeScrollLoop(dir: -1 | 1) {
  if (edgeScrollInterval !== null) return
  debugLog('content', 'edge-scroll', { dir })
  edgeScrollInterval = window.setInterval(() => {
    window.scrollBy({ top: dir * 40, behavior: 'auto' })
  }, 16)
}

function stopEdgeScrollLoop() {
  if (edgeScrollInterval !== null) {
    window.clearInterval(edgeScrollInterval)
    edgeScrollInterval = null
  }
}

function stopEdgeScroll() {
  stopEdgeScrollLoop()
  edgeScrollState = null
}

function setEnabled(enabled: boolean) {
  trackingEnabled = enabled
  if (!enabled) {
    cancelDwell()
    stopEdgeScroll()
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
