import type { TrackingMode, Point } from '../shared/types'
import { DEFAULT_CONFIG } from '../shared/types'
import { debugLog, debugEvery } from '../shared/debug'
import { WebcamManager } from './WebcamManager'
import { initFaceTracker, detectFaceLandmarks } from './FaceTracker'
import { initHandTracker, detectHandLandmarks, isHandTrackerReady } from './HandTracker'

const webcam = new WebcamManager(DEFAULT_CONFIG)

let mode: TrackingMode = 'face'
let running = false
let starting = false
let busy = false

debugLog('offscreen', 'module loaded')

function send(message: any) {
  try {
    chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError)
  } catch {
    // Background may be briefly unavailable (e.g. during startup).
  }
}

async function startTracking(): Promise<void> {
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
  } catch (error) {
    console.error('Offscreen: failed to start tracking', error)
    debugLog('offscreen', 'startTracking failed -> permission required', error)
    // Most likely the camera permission has not been granted to the extension.
    send({ type: 'CAMERA_PERMISSION_REQUIRED' })
  } finally {
    starting = false
  }
}

function stopTracking(): void {
  debugLog('offscreen', 'stopTracking')
  running = false
  webcam.stop()
}

async function processFrame(video: HTMLVideoElement, timestamp: number): Promise<void> {
  if (!running || busy) return
  busy = true
  try {
    let point: Point | null = null
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

async function setMode(next: TrackingMode): Promise<void> {
  debugLog('offscreen', 'setMode', next)
  if (next === 'hand' && !isHandTrackerReady()) {
    await initHandTracker()
    debugLog('offscreen', 'hand tracker ready:', isHandTrackerReady())
  }
  mode = next
}

chrome.runtime.onMessage.addListener((message: any) => {
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

export {}
