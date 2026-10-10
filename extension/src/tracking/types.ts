export type TrackingMode = 'face' | 'hand'

export interface Point {
  x: number
  y: number
}

export interface LandmarkData {
  point: Point
  confidence: number
}

export interface TrackingResult {
  cursorPoint: Point | null
  confidence: number
  landmarks?: Point[]
  rawLandmarks?: any
}

export interface CalibrationPoint {
  screen: Point
  camera: Point
}

export interface CalibrationData {
  points: CalibrationPoint[]
  matrix: number[] | null
  mode: TrackingMode
  timestamp: number
}

export interface TrackerConfig {
  mode: TrackingMode
  sensitivity: number
  deadZone: number
  smoothing: number
  showWebcamPreview: boolean
}

export const DEFAULT_CONFIG: TrackerConfig = {
  mode: 'face',
  sensitivity: 1.5,
  deadZone: 0.02,
  smoothing: 0.15,
  showWebcamPreview: false,
}