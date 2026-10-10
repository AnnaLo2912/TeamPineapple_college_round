export type TrackingMode = 'face' | 'hand'

export interface Point {
  x: number
  y: number
}

export interface TrackingResult {
  cursorPoint: Point | null
  confidence: number
  landmarks?: Point[]
  rawLandmarks?: any
}

export interface ClickableElement {
  element: Element
  rect: DOMRect
  center: Point
  tagName: string
  type?: string
  isInput: boolean
  isLink: boolean
  isButton: boolean
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
  magneticRadius: number
  snapStrength: number
  dwellTime: number
  edgeScroll: boolean
  edgeScrollBand: number
  isCalibrating?: boolean
}

export const DEFAULT_CONFIG: TrackerConfig = {
  mode: 'face',
  sensitivity: 1.5,
  deadZone: 0.02,
  smoothing: 0.15,
  showWebcamPreview: false,
  magneticRadius: 40,
  snapStrength: 0.3,
  dwellTime: 2500,
  edgeScroll: true,
  edgeScrollBand: 0.15,
}

export const DWELL_TIME = 800
export const CLICK_COOLDOWN = 1200

export type MessageType =
  | 'TOGGLE_TRACKING'
  | 'RECENTER'
  | 'SET_MODE'
  | 'START_CALIBRATION'
  | 'CONFIG_UPDATE'
  | 'GET_STATUS'
  | 'STATUS_UPDATE'
  | 'CALIBRATION_POINT'
  | 'CALIBRATION_COMPLETE'
  | 'CALIBRATION_CANCEL'
  | 'CLEAR_CALIBRATION'
  | 'TRACKING_RESULT'
  | 'CMD_NEXT_TAB'
  | 'CMD_PREV_TAB'

export interface BaseMessage {
  type: MessageType
  timestamp: number
}

export interface ToggleTrackingMessage extends BaseMessage {
  type: 'TOGGLE_TRACKING'
  enabled: boolean
}

export interface RecenterMessage extends BaseMessage {
  type: 'RECENTER'
}

export interface SetModeMessage extends BaseMessage {
  type: 'SET_MODE'
  mode: TrackingMode
}

export interface StartCalibrationMessage extends BaseMessage {
  type: 'START_CALIBRATION'
  mode: TrackingMode
}

export interface ConfigUpdateMessage extends BaseMessage {
  type: 'CONFIG_UPDATE'
  config: Partial<TrackerConfig>
}

export interface GetStatusMessage extends BaseMessage {
  type: 'GET_STATUS'
}

export interface StatusUpdateMessage extends BaseMessage {
  type: 'STATUS_UPDATE'
  enabled: boolean
  mode: TrackingMode
  tracking: boolean
  calibrationMode: TrackingMode | null
}

export interface CalibrationPointMessage extends BaseMessage {
  type: 'CALIBRATION_POINT'
  point: Point
  mode: TrackingMode
}

export interface CalibrationCompleteMessage extends BaseMessage {
  type: 'CALIBRATION_COMPLETE'
  mode: TrackingMode
  matrix: number[]
}

export interface CalibrationCancelMessage extends BaseMessage {
  type: 'CALIBRATION_CANCEL'
}

export interface ClearCalibrationMessage extends BaseMessage {
  type: 'CLEAR_CALIBRATION'
  mode: TrackingMode
}

export interface TrackingResultMessage extends BaseMessage {
  type: 'TRACKING_RESULT'
  rawPoint: Point | null
  confidence: number
  mode: TrackingMode
}

export interface CmdTabMessage extends BaseMessage {
  type: 'CMD_NEXT_TAB' | 'CMD_PREV_TAB'
}

export type ExtensionMessage =
  | ToggleTrackingMessage
  | RecenterMessage
  | SetModeMessage
  | StartCalibrationMessage
  | ConfigUpdateMessage
  | GetStatusMessage
  | StatusUpdateMessage
  | CalibrationPointMessage
  | CalibrationCompleteMessage
  | CalibrationCancelMessage
  | ClearCalibrationMessage
  | TrackingResultMessage
  | CmdTabMessage