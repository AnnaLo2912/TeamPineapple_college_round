import type { TrackingResult, Point, LandmarkData } from './types'

const FACE_LANDMARKER_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm/face_landmarker.task'
const VISION_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm/'

let faceLandmarker: any = null
let visionModule: any = null

async function loadVisionModule() {
  if (visionModule) return visionModule
  const module = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3')
  visionModule = module
  return module
}

export async function initFaceTracker(): Promise<boolean> {
  try {
    const { FaceLandmarker, FilesetResolver } = await loadVisionModule()
    
    const filesetResolver = await FilesetResolver.forVisionTasks(VISION_WASM_URL)
    
    faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: FACE_LANDMARKER_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    })
    
    return true
  } catch (error) {
    console.error('Failed to initialize Face Landmarker:', error)
    return false
  }
}

export function isFaceTrackerReady(): boolean {
  return faceLandmarker !== null
}

export async function detectFaceLandmarks(video: HTMLVideoElement, timestamp: number): Promise<TrackingResult> {
  if (!faceLandmarker || video.readyState < 2) {
    return { cursorPoint: null, confidence: 0 }
  }

  try {
    const result = faceLandmarker.detectForVideo(video, timestamp)
    
    if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
      return { cursorPoint: null, confidence: 0 }
    }

    const landmarks = result.faceLandmarks[0]
    
    const nose = landmarks[1]  // Nose tip
    const leftEye = landmarks[33]  // Left eye center
    const rightEye = landmarks[263]  // Right eye center
    const mouthTop = landmarks[13]  // Upper lip
    const mouthBottom = landmarks[14]  // Lower lip

    const cursorPoint: Point = {
      x: nose.x,
      y: nose.y,
    }

    const eyeDist = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y)
    const mouthOpen = Math.hypot(mouthTop.x - mouthBottom.x, mouthTop.y - mouthBottom.y)
    const confidence = Math.min(1, eyeDist * 10)  // Rough confidence based on eye separation

    const allLandmarks: Point[] = landmarks.map((l: any) => ({ x: l.x, y: l.y }))

    return {
      cursorPoint,
      confidence,
      landmarks: allLandmarks,
      rawLandmarks: {
        nose,
        leftEye,
        rightEye,
        mouthTop,
        mouthBottom,
        mouthOpen,
      },
    }
  } catch (error) {
    console.error('Face detection error:', error)
    return { cursorPoint: null, confidence: 0 }
  }
}

export function disposeFaceTracker() {
  if (faceLandmarker) {
    faceLandmarker.close()
    faceLandmarker = null
  }
}