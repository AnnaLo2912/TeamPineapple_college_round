import type { TrackingMode, TrackingResult, TrackerConfig, Point } from './types'
import { initFaceTracker, detectFaceLandmarks, disposeFaceTracker, isFaceTrackerReady } from './faceTracker'
import { CoordinateMapper } from './coordinateMapper'
import { WebcamManager } from './webcamManager'

let handTrackerModule: any = null

export class TrackingManager {
  private config: TrackerConfig
  private coordinateMapper: CoordinateMapper
  private webcamManager: WebcamManager
  private mode: TrackingMode = 'face'
  private isInitialized: boolean = false
  private isRunning: boolean = false
  private lastResult: TrackingResult = { cursorPoint: null, confidence: 0 }
  private onUpdateCallback: ((result: TrackingResult, mappedPoint: Point | null) => void) | null = null

  constructor(config: TrackerConfig) {
    this.config = config
    this.coordinateMapper = new CoordinateMapper(config)
    this.webcamManager = new WebcamManager(config)
  }

  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true

    const faceReady = await initFaceTracker()
    if (!faceReady) {
      console.error('Failed to initialize face tracker')
      return false
    }

    this.isInitialized = true
    return true
  }

  async start(): Promise<void> {
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

  private async processFrame(video: HTMLVideoElement, timestamp: number) {
    let result: TrackingResult

    if (this.mode === 'face') {
      result = await detectFaceLandmarks(video, timestamp)
    } else if (this.mode === 'hand') {
      result = await this.detectHandLandmarks(video, timestamp)
    } else {
      result = await detectFaceLandmarks(video, timestamp)
    }

    this.lastResult = result

    let mappedPoint: Point | null = null
    if (result.cursorPoint) {
      const smoothed = this.coordinateMapper.smoothPoint(result.cursorPoint)
      mappedPoint = this.coordinateMapper.mapPoint(smoothed)
    }

    if (this.onUpdateCallback) {
      this.onUpdateCallback(result, mappedPoint)
    }
  }

  private async detectHandLandmarks(video: HTMLVideoElement, timestamp: number): Promise<TrackingResult> {
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

  private async loadHandTracker(): Promise<void> {
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

  setMode(mode: TrackingMode) {
    if (mode === this.mode) return
    this.mode = mode
    this.coordinateMapper.resetSmoothing()
  }

  getMode(): TrackingMode {
    return this.mode
  }

  async toggleMode(): Promise<TrackingMode> {
    const modes: TrackingMode[] = ['face', 'hand']
    const currentIndex = modes.indexOf(this.mode)
    const nextMode = modes[(currentIndex + 1) % modes.length]
    this.setMode(nextMode)
    return nextMode
  }

  onUpdate(callback: (result: TrackingResult, mappedPoint: Point | null) => void) {
    this.onUpdateCallback = callback
  }

  setConfig(config: Partial<TrackerConfig>) {
    this.config = { ...this.config, ...config }
    this.coordinateMapper.setConfig(config)
    this.webcamManager.updateConfig(config)
  }

  getConfig(): TrackerConfig {
    return { ...this.config }
  }

  getCoordinateMapper(): CoordinateMapper {
    return this.coordinateMapper
  }

  getWebcamManager(): WebcamManager {
    return this.webcamManager
  }

  getLastResult(): TrackingResult {
    return { ...this.lastResult }
  }

  isTracking(): boolean {
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