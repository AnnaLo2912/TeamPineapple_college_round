import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

let handLandmarker = null

export async function initHandTracker() {
  if (handLandmarker) return true

  const wasmPath = chrome.runtime.getURL('models/wasm/')
  const modelPath = chrome.runtime.getURL('models/hand_landmarker.task')

  console.log('[HandTracker] Initializing Hand Landmarker...')
  console.log('[HandTracker] Local WASM path:', wasmPath)
  console.log('[HandTracker] Local Model path:', modelPath)

  // 1. Try local assets first
  try {
    const filesetResolver = await FilesetResolver.forVisionTasks(wasmPath)

    try {
      handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })
      console.log('[HandTracker] Initialized successfully with Local assets + GPU delegate.')
      return true
    } catch (gpuErr) {
      console.warn('[HandTracker] GPU delegate failed on local assets, trying CPU fallback:', gpuErr)
      handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })
      console.log('[HandTracker] Initialized successfully with Local assets + CPU delegate.')
      return true
    }
  } catch (localError) {
    console.warn('[HandTracker] Local asset initialization failed, trying CDN fallback:', localError)
  }

  // 2. Fallback to CDN assets if local assets fail
  try {
    const cdnWasm = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
    const cdnModel = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

    const filesetResolver = await FilesetResolver.forVisionTasks(cdnWasm)

    try {
      handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: cdnModel,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })
      console.log('[HandTracker] Initialized successfully with CDN assets + GPU delegate.')
      return true
    } catch (gpuErr) {
      console.warn('[HandTracker] GPU delegate failed on CDN assets, trying CPU fallback:', gpuErr)
      handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: cdnModel,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })
      console.log('[HandTracker] Initialized successfully with CDN assets + CPU delegate.')
      return true
    }
  } catch (cdnError) {
    console.error('[HandTracker] Complete initialization failure (Local & CDN):', cdnError)
    return false
  }
}

export function isHandTrackerReady() {
  return handLandmarker !== null
}

export async function detectHandLandmarks(video, timestamp) {
  if (!handLandmarker || video.readyState < 2) {
    return { cursorPoint: null, confidence: 0 }
  }

  try {
    const result = handLandmarker.detectForVideo(video, timestamp)

    if (!result.landmarks || result.landmarks.length === 0) {
      return { cursorPoint: null, confidence: 0 }
    }

    const landmarks = result.landmarks[0]
    const indexTip = landmarks[8]
    const handedness = result.handedness[0]?.[0]?.categoryName || 'Right'

    const cursorPoint = {
      x: indexTip.x,
      y: indexTip.y,
    }

    const confidence = indexTip.z < 0 ? 0.5 : Math.min(1, 1 - Math.abs(indexTip.z))

    return {
      cursorPoint,
      confidence,
      landmarks: landmarks.map((l) => ({ x: l.x, y: l.y })),
      rawLandmarks: { indexTip, handedness },
    }
  } catch (error) {
    console.error('Hand detection error:', error)
    return { cursorPoint: null, confidence: 0 }
  }
}

export function disposeHandTracker() {
  if (handLandmarker) {
    handLandmarker.close()
    handLandmarker = null
  }
}
