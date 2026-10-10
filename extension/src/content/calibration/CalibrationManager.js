import { CALIBRATION_POINTS } from '../../shared/constants.js'

const STORAGE_KEYS = {
  CONFIG: 'handsfree_config',
  CALIBRATION_FACE: 'handsfree_calibration_face',
  CALIBRATION_HAND: 'handsfree_calibration_hand',
}

export class CalibrationManager {
  constructor() {
    this.calibrationData = new Map()
    this.currentMode = 'face'
    this.collectedPoints = []
    this.currentPointIndex = 0
    this.isCalibrating = false
    this.onProgressCallback = null
    this.onCompleteCallback = null

    this.loadFromStorage()
  }

  async loadFromStorage() {
    try {
      const faceCal = await chrome.storage.sync.get('handsfree_calibration_face')
      const handCal = await chrome.storage.sync.get('handsfree_calibration_hand')

      if (faceCal.handsfree_calibration_face) {
        const parsed = faceCal.handsfree_calibration_face
        this.calibrationData.set('face', {
          ...parsed,
          points: parsed.points.map((p) => ({
            screen: p.screen,
            camera: p.camera,
          })),
        })
      }

      if (handCal.handsfree_calibration_hand) {
        const parsed = handCal.handsfree_calibration_hand
        this.calibrationData.set('hand', {
          ...parsed,
          points: parsed.points.map((p) => ({
            screen: p.screen,
            camera: p.camera,
          })),
        })
      }
    } catch (e) {
      console.warn('Failed to load calibration:', e)
    }
  }

  async saveToStorage() {
    try {
      const faceCal = this.calibrationData.get('face')
      const handCal = this.calibrationData.get('hand')

      if (faceCal) {
        await chrome.storage.sync.set({ handsfree_calibration_face: faceCal })
      }
      if (handCal) {
        await chrome.storage.sync.set({ handsfree_calibration_hand: handCal })
      }
    } catch (e) {
      console.warn('Failed to save calibration:', e)
    }
  }

  getCalibration(mode) {
    return this.calibrationData.get(mode) || null
  }

  hasCalibration(mode) {
    const data = this.calibrationData.get(mode)
    return data !== null && data.matrix !== null && data.points.length >= 4
  }

  startCalibration(mode, onProgress, onComplete) {
    this.currentMode = mode
    this.collectedPoints = []
    this.currentPointIndex = 0
    this.isCalibrating = true
    this.onProgressCallback = onProgress
    this.onCompleteCallback = onComplete

    const point = CALIBRATION_POINTS[0]
    onProgress({ current: 1, total: CALIBRATION_POINTS.length, point })
    return point
  }

  addCalibrationPoint(cameraPoint) {
    if (!this.isCalibrating || this.currentPointIndex >= CALIBRATION_POINTS.length) {
      return { done: true }
    }

    const screenPoint = CALIBRATION_POINTS[this.currentPointIndex]
    this.collectedPoints.push({
      screen: screenPoint,
      camera: cameraPoint,
    })

    this.currentPointIndex++

    if (this.currentPointIndex >= CALIBRATION_POINTS.length) {
      this.finishCalibration()
      return { done: true }
    }

    const nextPoint = CALIBRATION_POINTS[this.currentPointIndex]
    const progress = { current: this.currentPointIndex + 1, total: CALIBRATION_POINTS.length, point: nextPoint }
    this.onProgressCallback?.(progress)
    return { done: false, nextPoint, progress }
  }

  finishCalibration() {
    const matrix = this.computeMatrix(this.collectedPoints)

    const data = {
      points: this.collectedPoints,
      matrix,
      mode: this.currentMode,
      timestamp: Date.now(),
    }

    this.calibrationData.set(this.currentMode, data)
    this.saveToStorage()
    this.isCalibrating = false
    this.onCompleteCallback?.(data)
  }

  computeMatrix(points) {
    if (points.length < 4) return null

    const A = []
    const B = []

    for (const p of points) {
      const cx = p.camera.x
      const cy = p.camera.y
      const sx = p.screen.x
      const sy = p.screen.y

      A.push(cx, cy, 1, 0, 0, 0)
      A.push(0, 0, 0, cx, cy, 1)
      B.push(sx, sy)
    }

    try {
      return this.solveLeastSquares(A, B, 6)
    } catch {
      return null
    }
  }

  solveLeastSquares(A, B, n) {
    const m = B.length
    const AT = new Array(n * m).fill(0)
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        AT[j * m + i] = A[i * n + j]
      }
    }

    const ATA = new Array(n * n).fill(0)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let sum = 0
        for (let k = 0; k < m; k++) {
          sum += AT[i * m + k] * A[k * n + j]
        }
        ATA[i * n + j] = sum
      }
    }

    const ATB = new Array(n).fill(0)
    for (let i = 0; i < n; i++) {
      let sum = 0
      for (let k = 0; k < m; k++) {
        sum += AT[i * m + k] * B[k]
      }
      ATB[i] = sum
    }

    return this.gaussianElimination(ATA, ATB, n)
  }

  gaussianElimination(A, B, n) {
    const M = A.map((val, i) => [...A.slice(i * n, (i + 1) * n), B[i]])

    for (let i = 0; i < n; i++) {
      let maxRow = i
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) {
          maxRow = k
        }
      }
      ;[M[i], M[maxRow]] = [M[maxRow], M[i]]

      const pivot = M[i][i]
      if (Math.abs(pivot) < 1e-10) throw new Error('Singular matrix')
      for (let j = i; j <= n; j++) {
        M[i][j] /= pivot
      }

      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = M[k][i]
          for (let j = i; j <= n; j++) {
            M[k][j] -= factor * M[i][j]
          }
        }
      }
    }

    return M.map(row => row[n])
  }

  cancelCalibration() {
    this.isCalibrating = false
    this.collectedPoints = []
    this.currentPointIndex = 0
  }

  clearCalibration(mode) {
    this.calibrationData.delete(mode)
    this.saveToStorage()
  }

  clearAllCalibrations() {
    this.calibrationData.clear()
    this.saveToStorage()
  }

  recenter(cameraCenter, mode) {
    const existing = this.calibrationData.get(mode)
    if (!existing || !existing.matrix) return null

    const adjustedPoints = existing.points.map(p => ({
      ...p,
      camera: {
        x: p.camera.x - cameraCenter.x + 0.5,
        y: p.camera.y - cameraCenter.y + 0.5,
      },
    }))

    const matrix = this.computeMatrix(adjustedPoints)
    if (!matrix) return null

    const updated = {
      ...existing,
      points: adjustedPoints,
      matrix,
      mode,
      timestamp: Date.now(),
    }

    this.calibrationData.set(mode, updated)
    this.saveToStorage()
    return updated
  }

  getCalibrationPoints() {
    return CALIBRATION_POINTS
  }

  getCurrentProgress() {
    if (!this.isCalibrating) return null
    return { current: this.currentPointIndex, total: CALIBRATION_POINTS.length }
  }

  isCalibratingMode() {
    return this.isCalibrating
  }

  getCurrentMode() {
    return this.currentMode
  }
}

export const calibrationManager = new CalibrationManager()
