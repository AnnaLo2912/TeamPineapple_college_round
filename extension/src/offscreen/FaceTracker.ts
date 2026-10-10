import type { TrackingResult, Point } from '../shared/types'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

let faceLandmarker: any = null

export async function initFaceTracker(): Promise<boolean> {
  if (faceLandmarker) return true

  const wasmPath = chrome.runtime.getURL('models/wasm/')
  const modelPath = chrome.runtime.getURL('models/face_landmarker.task')

  console.log('[FaceTracker] Initializing Face Landmarker...')
  console.log('[FaceTracker] Local WASM path:', wasmPath)
  console.log('[FaceTracker] Local Model path:', modelPath)

  // 1. Try local assets first
  try {
    const filesetResolver = await FilesetResolver.forVisionTasks(wasmPath)

    try {
      faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: modelPath,
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
      console.log('[FaceTracker] Initialized successfully with Local assets + GPU delegate.')
      return true
    } catch (gpuErr) {
      console.warn('[FaceTracker] GPU delegate failed on local assets, trying CPU fallback:', gpuErr)
      faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      })
      console.log('[FaceTracker] Initialized successfully with Local assets + CPU delegate.')
      return true
    }
  } catch (localError) {
    console.warn('[FaceTracker] Local asset initialization failed, trying CDN fallback:', localError)
  }

  // 2. Fallback to CDN assets if local assets fail
  try {
    const cdnWasm = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
    const cdnModel = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

    const filesetResolver = await FilesetResolver.forVisionTasks(cdnWasm)
    
    try {
      faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: cdnModel,
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
      console.log('[FaceTracker] Initialized successfully with CDN assets + GPU delegate.')
      return true
    } catch (gpuErr) {
      console.warn('[FaceTracker] GPU delegate failed on CDN assets, trying CPU fallback:', gpuErr)
      faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: cdnModel,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      })
      console.log('[FaceTracker] Initialized successfully with CDN assets + CPU delegate.')
      return true
    }
  } catch (cdnError) {
    console.error('[FaceTracker] Complete initialization failure (Local & CDN):', cdnError)
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

    const nose = landmarks[1]
    const leftEye = landmarks[33]
    const rightEye = landmarks[263]
    const mouthTop = landmarks[13]
    const mouthBottom = landmarks[14]

    const cursorPoint: Point = {
      x: nose.x,
      y: nose.y,
    }

    const eyeDist = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y)
    const mouthOpen = Math.hypot(mouthTop.x - mouthBottom.x, mouthTop.y - mouthBottom.y)
    const confidence = Math.min(1, eyeDist * 10)

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
