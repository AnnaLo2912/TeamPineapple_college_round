import type { TrackerConfig } from './types'

export class WebcamManager {
  private stream: MediaStream | null = null
  private video: HTMLVideoElement | null = null
  private config: TrackerConfig
  private onFrameCallback: ((video: HTMLVideoElement, timestamp: number) => void) | null = null
  private animationId: number | null = null
  private isRunning: boolean = false

  constructor(config: TrackerConfig) {
    this.config = config
  }

  async start(videoElement?: HTMLVideoElement): Promise<HTMLVideoElement> {
    if (this.isRunning && this.video) {
      return this.video
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
        audio: false,
      })

      this.video = videoElement || document.createElement('video')
      this.video.srcObject = this.stream
      this.video.setAttribute('playsinline', 'true')
      this.video.setAttribute('muted', 'true')
      
      await new Promise<void>((resolve, reject) => {
        if (!this.video) return reject(new Error('No video element'))
        this.video.onloadedmetadata = () => {
          this.video!.play().then(resolve).catch(reject)
        }
        this.video.onerror = reject
        setTimeout(() => reject(new Error('Video load timeout')), 10000)
      })

      this.isRunning = true
      this.startFrameLoop()
      
      return this.video
    } catch (error) {
      console.error('Failed to start webcam:', error)
      throw error
    }
  }

  stop() {
    this.isRunning = false
    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop())
      this.stream = null
    }
    if (this.video) {
      this.video.srcObject = null
    }
  }

  private startFrameLoop() {
    const loop = (timestamp: number) => {
      if (!this.isRunning || !this.video) return
      if (this.onFrameCallback && this.video.readyState >= 2) {
        this.onFrameCallback(this.video, timestamp)
      }
      this.animationId = requestAnimationFrame(loop)
    }
    this.animationId = requestAnimationFrame(loop)
  }

  onFrame(callback: (video: HTMLVideoElement, timestamp: number) => void) {
    this.onFrameCallback = callback
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.video
  }

  isActive(): boolean {
    return this.isRunning && this.video !== null && this.video.readyState >= 2
  }

  async switchCamera(deviceId: string): Promise<void> {
    const wasRunning = this.isRunning
    this.stop()
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    })
    if (wasRunning && this.video) {
      this.video.srcObject = this.stream
      await this.video.play()
      this.isRunning = true
      this.startFrameLoop()
    }
  }

  async listCameras(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter(d => d.kind === 'videoinput')
  }

  updateConfig(config: Partial<TrackerConfig>) {
    this.config = { ...this.config, ...config }
  }
}