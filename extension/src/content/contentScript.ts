import type { TrackerConfig, Point, ClickableElement, TrackingMode, ExtensionMessage } from '../shared/types'
import { DEFAULT_CONFIG, DWELL_TIME, CLICK_COOLDOWN } from '../shared/types'
import { CALIBRATION_POINTS } from '../shared/constants'
import { CoordinateMapper } from './tracker/CoordinateMapper'
import { CursorOverlay } from './overlay/CursorOverlay'
import { TargetHighlighter } from './overlay/TargetHighlighter'
import { CalibrationOverlay } from './overlay/CalibrationOverlay'
import { calibrationManager } from './calibration/CalibrationManager'
import { targetDetector } from './overlay/TargetDetector'
import { messagingBridge, loadConfig, saveConfig, getCalibration, saveCalibration } from './messaging/MessagingBridge'
import { debugLog, debugEvery } from '../shared/debug'

let config: TrackerConfig = DEFAULT_CONFIG
let coordinateMapper: CoordinateMapper | null = null
let cursorOverlay: CursorOverlay | null = null
let targetHighlighter: TargetHighlighter | null = null
let calibrationOverlay: CalibrationOverlay | null = null
let lastClickTime = 0
let currentDwellTarget: ClickableElement | null = null
let lastRawPoint: Point | null = null
let trackingEnabled = true

let calibrationTargetIndex = -1
let calibrationDwellStart = 0

function initOverlay() {
  cursorOverlay = new CursorOverlay(config.magneticRadius, config.snapStrength)
  targetHighlighter = new TargetHighlighter()
  calibrationOverlay = new CalibrationOverlay()
}

async function init() {
  config = await loadConfig()
  coordinateMapper = new CoordinateMapper(config)
  debugLog('content', 'init', { mode: config.mode, mapper: !!coordinateMapper })

  cursorOverlay?.setMode(config.mode)

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
  const target = targetDetector.getTargetAtPoint(mappedPoint.x, mappedPoint.y, 20)

  if (target && target !== currentDwellTarget) {
    startDwell(target)
  } else if (!target && currentDwellTarget) {
    cancelDwell()
  }

  if (cursorOverlay) {
    cursorOverlay.updatePosition(snappedPosition)
    cursorOverlay.updateTarget(target)
    cursorOverlay.setMagneticParams(config.magneticRadius, config.snapStrength)
  }

  targetHighlighter?.updateTarget(target)
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
  ;(target as any).dwellStartTime = Date.now()
  cursorOverlay?.startDwell(target, executeClick)
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

  const element = target.element as HTMLElement
  element.click()
  element.focus()
}

function setEnabled(enabled: boolean) {
  trackingEnabled = enabled
  if (!enabled) {
    cancelDwell()
    cursorOverlay?.hide()
    targetHighlighter?.hide()
  }
}

function handleRecenter() {
  if (lastRawPoint && coordinateMapper) {
    const recentered = calibrationManager.recenter(lastRawPoint)
    if (recentered) {
      coordinateMapper.setCalibration(recentered)
    }
  }
}

async function setMode(mode: TrackingMode) {
  config.mode = mode
  await saveConfig(config)

  cursorOverlay?.setMode(mode)
  coordinateMapper?.resetSmoothing()

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
