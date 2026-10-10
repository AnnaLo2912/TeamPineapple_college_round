import { initFaceTracker, detectFaceLandmarks, disposeFaceTracker, isFaceTrackerReady } from './faceTracker.js'
import { CoordinateMapper } from './coordinateMapper.js'
import { WebcamManager } from './webcamManager.js'

let handTrackerModule = null

export class TrackingManager {
  constructor(config) {
    this.config = config
    this.coordinateMapper = new CoordinateMapper(config)
    this.webcamManager = new WebcamManager(config)
    this.mode = 'face'
    this.isInitialized = false
    this.isRunning = false
    this.lastResult = { cursorPoint: null, confidence: 0 }
    this.onUpdateCallback = null
  }

  async initialize() {
    if (this.isInitialized) return true

    const faceReady = await initFaceTracker()
    if (!faceReady) {
      console.error('Failed to initialize face tracker')
      return false
    }

    this.isInitialized = true
    return true
  }

  async start() {
    if (this.isRunning) return
    if (!this.isInitialized) {
      await this.initialize()
    }

    await this.webcamManager.start()
    this.webcamManager.onFrame(this.processFrame.bind(this))
    this.isRunning = true
  }

  stop() {
    this.webcamManager.stop()
    this.isRunning = false
    this.coordinateMapper.resetSmoothing()
  }

  async processFrame(video, timestamp) {
    let result

    if (this.mode === 'face') {
      result = await detectFaceLandmarks(video, timestamp)
    } else if (this.mode === 'hand') {
      result = await this.detectHandLandmarks(video, timestamp)
    } else {
      result = await detectFaceLandmarks(video, timestamp)
    }

    this.lastResult = result

    let mappedPoint = null
    if (result.cursorPoint) {
      const smoothed = this.coordinateMapper.smoothPoint(result.cursorPoint)
      mappedPoint = this.coordinateMapper.mapPoint(smoothed)
    }

    if (this.onUpdateCallback) {
      this.onUpdateCallback(result, mappedPoint)
    }
  }

  async detectHandLandmarks(video, timestamp) {
    if (!handTrackerModule) {
      await this.loadHandTracker()
    }
    if (!handTrackerModule || !handTrackerModule.handLandmarker) {
      return { cursorPoint: null, confidence: 0 }
    }

    try {
      const result = handTrackerModule.handLandmarker.detectForVideo(video, timestamp)
      
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

  async loadHandTracker() {
    if (handTrackerModule) return

    try {
      const { HandLandmarker, FilesetResolver } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3')
      const wasmUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm/'
      const modelUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm/hand_landmarker.task'

      const filesetResolver = await FilesetResolver.forVisionTasks(wasmUrl)
      const handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: modelUrl,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })

      handTrackerModule = { handLandmarker }
    } catch (error) {
      console.error('Failed to load hand tracker:', error)
    }
  }

  setMode(mode) {
    if (mode === this.mode) return
    this.mode = mode
    this.coordinateMapper.resetSmoothing()
  }

  getMode() {
    return this.mode
  }

  async toggleMode() {
    const modes = ['face', 'hand']
    const currentIndex = modes.indexOf(this.mode)
    const nextMode = modes[(currentIndex + 1) % modes.length]
    this.setMode(nextMode)
    return nextMode
  }

  onUpdate(callback) {
    this.onUpdateCallback = callback
  }

  setConfig(config) {
    this.config = { ...this.config, ...config }
    this.coordinateMapper.setConfig(config)
    this.webcamManager.updateConfig(config)
  }

  getConfig() {
    return { ...this.config }
  }

  getCoordinateMapper() {
    return this.coordinateMapper
  }

  getWebcamManager() {
    return this.webcamManager
  }

  getLastResult() {
    return { ...this.lastResult }
  }

  isTracking() {
    return this.isRunning
  }

  dispose() {
    this.stop()
    disposeFaceTracker()
    if (handTrackerModule?.handLandmarker) {
      handTrackerModule.handLandmarker.close()
      handTrackerModule = null
    }
    this.coordinateMapper.destroy()
    this.isInitialized = false
  }
}
