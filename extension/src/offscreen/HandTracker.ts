import type { TrackingResult, Point } from '../shared/types'
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

let handLandmarker: any = null

export async function initHandTracker(): Promise<boolean> {
  if (handLandmarker) return true

  try {
    const wasmPath = chrome.runtime.getURL('models/wasm/')
    const modelPath = chrome.runtime.getURL('models/hand_landmarker.task')

    const filesetResolver = await FilesetResolver.forVisionTasks(wasmPath)

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

    return true
  } catch (error) {
    console.error('Failed to initialize Hand Landmarker:', error)
    return false
  }
}

export function isHandTrackerReady(): boolean {
  return handLandmarker !== null
}

export async function detectHandLandmarks(video: HTMLVideoElement, timestamp: number): Promise<TrackingResult> {
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

    const cursorPoint: Point = {
      x: indexTip.x,
      y: indexTip.y,
    }

    const confidence = indexTip.z < 0 ? 0.5 : Math.min(1, 1 - Math.abs(indexTip.z))

    return {
      cursorPoint,
      confidence,
      landmarks: landmarks.map((l: any) => ({ x: l.x, y: l.y })),
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
