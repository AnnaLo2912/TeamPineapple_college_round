import type { Point, CalibrationData, CalibrationPoint, TrackerConfig } from '../../shared/types'

export class CoordinateMapper {
  private config: TrackerConfig
  private calibration: CalibrationData | null = null
  private smoothedPoint: Point | null = null
  private lastRawPoint: Point | null = null
  private viewportWidth: number
  private viewportHeight: number

  constructor(config: TrackerConfig) {
    this.config = config
    this.viewportWidth = window.innerWidth
    this.viewportHeight = window.innerHeight
    window.addEventListener('resize', this.handleResize.bind(this))
  }

  private handleResize() {
    this.viewportWidth = window.innerWidth
    this.viewportHeight = window.innerHeight
  }

  setConfig(config: Partial<TrackerConfig>) {
    this.config = { ...this.config, ...config }
  }

  setCalibration(data: CalibrationData) {
    this.calibration = data
  }

  getCalibration(): CalibrationData | null {
    return this.calibration
  }

  clearCalibration() {
    this.calibration = null
  }

  mapPoint(rawPoint: Point): Point {
    if (!this.calibration || !this.calibration.matrix) {
      return this.mapDirect(rawPoint)
    }
    return this.mapCalibrated(rawPoint)
  }

  private mapDirect(rawPoint: Point): Point {
    const { sensitivity, deadZone } = this.config
    const centerX = 0.5
    const centerY = 0.5

    // Webcam is mirrored: user's right = landmark x decreases
    // Invert X so natural movement: left head = left cursor
    let dx = (centerX - rawPoint.x) * sensitivity
    let dy = (rawPoint.y - centerY) * sensitivity

    const dist = Math.hypot(dx, dy)
    if (dist < deadZone) {
      dx = 0
      dy = 0
    }

    const x = Math.max(0, Math.min(this.viewportWidth, this.viewportWidth * (0.5 + dx)))
    const y = Math.max(0, Math.min(this.viewportHeight, this.viewportHeight * (0.5 + dy)))

    return { x, y }
  }

  private mapCalibrated(rawPoint: Point): Point {
    const m = this.calibration!.matrix!

    const x = m[0] * rawPoint.x + m[1] * rawPoint.y + m[2]
    const y = m[3] * rawPoint.x + m[4] * rawPoint.y + m[5]

    return {
      x: Math.max(0, Math.min(this.viewportWidth, x)),
      y: Math.max(0, Math.min(this.viewportHeight, y)),
    }
  }

  smoothPoint(rawPoint: Point): Point {
    const alpha = this.config.smoothing

    if (this.smoothedPoint === null) {
      this.smoothedPoint = { ...rawPoint }
      this.lastRawPoint = { ...rawPoint }
      return this.smoothedPoint
    }

    const rawDist = Math.hypot(rawPoint.x - this.lastRawPoint!.x, rawPoint.y - this.lastRawPoint!.y)
    const adaptiveAlpha = rawDist > 0.02 ? Math.min(alpha * 3, 0.5) : alpha

    this.smoothedPoint.x += (rawPoint.x - this.smoothedPoint.x) * adaptiveAlpha
    this.smoothedPoint.y += (rawPoint.y - this.smoothedPoint.y) * adaptiveAlpha
    this.lastRawPoint = { ...rawPoint }

    return { ...this.smoothedPoint }
  }

  resetSmoothing() {
    this.smoothedPoint = null
    this.lastRawPoint = null
  }

  computeCalibrationMatrix(points: CalibrationPoint[]): number[] | null {
    if (points.length < 4) return null

    const A: number[] = []
    const B: number[] = []

    for (const p of points) {
      A.push(p.camera.x, p.camera.y, 1, 0, 0, 0)
      A.push(0, 0, 0, p.camera.x, p.camera.y, 1)
      B.push(p.screen.x, p.screen.y)
    }

    try {
      return this.solveLeastSquares(A, B, 6)
    } catch {
      return null
    }
  }

  private solveLeastSquares(A: number[], B: number[], n: number): number[] {
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

  private gaussianElimination(A: number[], B: number[], n: number): number[] {
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

  destroy() {
    window.removeEventListener('resize', this.handleResize.bind(this))
  }
}