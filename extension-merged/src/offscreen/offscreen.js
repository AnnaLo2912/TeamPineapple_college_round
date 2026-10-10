import { DEFAULT_CONFIG } from '../shared/types.js'
import { debugLog, debugEvery } from '../shared/debug.js'
import { WebcamManager } from './WebcamManager.js'
import { initFaceTracker, detectFaceLandmarks } from './FaceTracker.js'
import { initHandTracker, detectHandLandmarks, isHandTrackerReady } from './HandTracker.js'
import { SpeechRecognizer } from './SpeechRecognizer.js'

const webcam = new WebcamManager(DEFAULT_CONFIG)
const speechRecognizer = new SpeechRecognizer((cmd) => {
  send(cmd)
})

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
      console.error('Offscreen: face tracker failed to initialize')
      return
    }
    if (mode === 'hand' && !isHandTrackerReady()) {
      await initHandTracker()
    }

    await webcam.start()
    webcam.onFrame(processFrame)
    running = true
    debugLog('offscreen', 'tracking running')
    speechRecognizer.start()
  } catch (error) {
    console.error('Offscreen: failed to start tracking', error)
    debugLog('offscreen', 'startTracking failed -> permission required', error)
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
  speechRecognizer.stop()
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
