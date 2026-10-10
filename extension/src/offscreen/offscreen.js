// Route MediaPipe internal C++ debug/warning logs so Chromium doesn't flag them as extension issues
globalThis.dbg = function(msg) {
  console.debug('[MediaPipe WASM]', msg)
}
globalThis.custom_dbg = function(msg) {
  console.debug('[MediaPipe WASM]', msg)
}

const origError = console.error
const origWarn = console.warn

const isMediaPipeEngineLog = (text) => {
  const str = typeof text === 'object' ? (text?.message || text?.stack || JSON.stringify(text) || String(text)) : String(text)
  return (
    str.includes('INFO:') ||
    str.includes('XNNPACK') ||
    str.includes('TensorFlow Lite') ||
    str.includes('face_landmarker_graph') ||
    str.includes('gl_context') ||
    str.includes('FaceBlendshapesGraph') ||
    str.includes('NORM_RECT') ||
    str.includes('landmark_projection_calculator') ||
    str.includes('OpenGL error checking') ||
    str.includes('Sets FaceBlendshapesGraph')
  )
}

// Emscripten Module hooks: intercept stderr/stdout from WASM before anything else
globalThis.Module = globalThis.Module || {}
globalThis.Module.printErr = function(text) {
  if (isMediaPipeEngineLog(text)) {
    console.debug('[MediaPipe Info]', text)
    return
  }
  origError.call(console, text)
}
globalThis.Module.print = function(text) {
  console.debug('[MediaPipe stdout]', text)
}

// Intercept console.error to prevent benign MediaPipe / Emscripten C++ logs from flagging extension issues
console.error = function(...args) {
  const msg = args.map(a => (typeof a === 'object' ? (a?.message || a?.stack || JSON.stringify(a) || String(a)) : String(a))).join(' ')
  if (isMediaPipeEngineLog(msg)) {
    console.debug('[MediaPipe Info]', ...args)
    return
  }
  origError.apply(console, args)
}

// Filter benign MediaPipe/Emscripten C++ engine initialization warnings from console.warn
console.warn = function(...args) {
  const msg = args.map(a => (typeof a === 'object' ? (a?.message || a?.stack || JSON.stringify(a) || String(a)) : String(a))).join(' ')
  if (isMediaPipeEngineLog(msg)) {
    console.debug('[MediaPipe Info]', ...args)
    return
  }
  origWarn.apply(console, args)
}

import { DEFAULT_CONFIG } from '../shared/types.js'
import { debugLog, debugEvery } from '../shared/debug.js'
import { WebcamManager } from './WebcamManager.js'
import { initFaceTracker, detectFaceLandmarks } from './FaceTracker.js'
import { initHandTracker, detectHandLandmarks, isHandTrackerReady } from './HandTracker.js'

const webcam = new WebcamManager(DEFAULT_CONFIG)

let mode = 'face'
let running = false
let starting = false
let busy = false

debugLog('offscreen', 'module loaded')

function send(message) {
  try {
    chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError)
  } catch {
    // Background may be briefly unavailable (e.g. during startup).
  }
}

let lastPermissionRequestTime = 0

async function startTracking() {
  if (running || starting) {
    debugLog('offscreen', 'startTracking skipped', { running, starting })
    return
  }
  starting = true
  debugLog('offscreen', 'startTracking begin', { mode })
  try {
    const faceReady = await initFaceTracker()
    debugLog('offscreen', 'face tracker ready:', faceReady)
    if (!faceReady) {
      console.warn('[Handsfree] Face tracker not ready, retrying on next command')
      return
    }
    if (mode === 'hand' && !isHandTrackerReady()) {
      await initHandTracker()
    }

    await webcam.start()
    webcam.onFrame(processFrame)
    running = true
    debugLog('offscreen', 'tracking running')
  } catch (error) {
    const isPermissionError =
      error?.name === 'NotAllowedError' ||
      error?.name === 'PermissionDeniedError' ||
      error?.name === 'SecurityError' ||
      (typeof error?.message === 'string' && error.message.toLowerCase().includes('permission'))

    if (isPermissionError) {
      debugLog('offscreen', 'Camera permission not yet granted; requesting permission tab from background')
      console.info('[Handsfree] Camera permission required. Requesting user permission tab...')
    } else {
      console.warn('[Handsfree] Failed to start camera tracking:', error?.name || error?.message || error)
    }

    // Throttle camera permission tab opening to avoid infinite creation loops
    const now = Date.now()
    if (now - lastPermissionRequestTime > 8000) {
      lastPermissionRequestTime = now
      send({ type: 'CAMERA_PERMISSION_REQUIRED' })
    }
  } finally {
    starting = false
  }
}

function stopTracking() {
  debugLog('offscreen', 'stopTracking')
  running = false
  webcam.stop()
}

async function processFrame(video, timestamp) {
  if (!running || busy) return
  busy = true
  try {
    let point = null
    let confidence = 0

    if (mode === 'hand' && isHandTrackerReady()) {
      const result = await detectHandLandmarks(video, timestamp)
      point = result.cursorPoint
      confidence = result.confidence
    } else {
      const result = await detectFaceLandmarks(video, timestamp)
      point = result.cursorPoint
      confidence = result.confidence
    }

    debugEvery('offscreen:frame', 15, 'frame', {
      mode,
      hasPoint: point !== null,
      confidence: Math.round(confidence * 100) / 100,
    })

    send({ type: 'TRACKING_RESULT', rawPoint: point, confidence, mode })
  } finally {
    busy = false
  }
}

async function setMode(next) {
  debugLog('offscreen', 'setMode', next)
  if (next === 'hand' && !isHandTrackerReady()) {
    await initHandTracker()
    debugLog('offscreen', 'hand tracker ready:', isHandTrackerReady())
  }
  mode = next
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.target !== 'offscreen') return
  debugLog('offscreen', 'command', message.type)

  switch (message.type) {
    case 'OFFSCREEN_START':
      void startTracking()
      break
    case 'OFFSCREEN_STOP':
      stopTracking()
      break
    case 'OFFSCREEN_SET_MODE':
      if (message.mode) void setMode(message.mode)
      break
  }
})

// Tell the background we are ready to receive commands (avoids a startup race
// where the service worker sends START before this listener is registered).
send({ type: 'OFFSCREEN_READY' })
