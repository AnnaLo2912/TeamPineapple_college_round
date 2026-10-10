import { debugLog, debugEvery } from '../shared/debug.js'

export class WebcamManager {
  constructor(config) {
    this.stream = null
    this.video = null
    this.config = config
    this.onFrameCallback = null
    this.loopId = null
    this.isRunning = false
    this.ownsVideo = false
  }

  async start(videoElement) {
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
      debugLog('webcam', 'getUserMedia resolved')

      this.video = videoElement || document.createElement('video')
      this.video.srcObject = this.stream
      this.video.setAttribute('playsinline', 'true')
      this.video.muted = true

      if (!videoElement) {
        // Keep the video in the DOM but park it off-screen
        this.video.style.cssText =
          'position:fixed;left:-9999px;top:-9999px;width:640px;height:480px;opacity:0;pointer-events:none;'
        document.body.appendChild(this.video)
        this.ownsVideo = true
      }

      await new Promise((resolve, reject) => {
        if (!this.video) return reject(new Error('No video element'))
        this.video.onloadedmetadata = () => {
          if (this.video) {
            this.video.width = this.video.videoWidth || 640
            this.video.height = this.video.videoHeight || 480
          }
          debugLog('webcam', 'video metadata', {
            w: this.video?.videoWidth,
            h: this.video?.videoHeight,
          })
          this.video?.play().then(resolve).catch((err) => {
            debugLog('webcam', 'video.play() rejected', err)
            reject(err)
          })
        }
        this.video.onerror = () => reject(new Error('Video element error'))
        setTimeout(() => reject(new Error('Video load timeout')), 10000)
      })

      this.isRunning = true
      this.startFrameLoop()

      debugLog('webcam', 'started')
      return this.video
    } catch (error) {
      debugLog('webcam', 'start failed', error)
      throw error
    }
  }

  stop() {
    this.isRunning = false
    this.stopFrameLoop()
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop())
      this.stream = null
    }
    if (this.video) {
      this.video.srcObject = null
      if (this.ownsVideo && this.video.parentNode) {
        this.video.parentNode.removeChild(this.video)
      }
      this.video = null
    }
    debugLog('webcam', 'stopped')
  }

  startFrameLoop() {
    this.stopFrameLoop()
    // Offscreen documents are hidden, so requestAnimationFrame is throttled/
    // paused there. A plain interval keeps the detection loop running.
    this.loopId = setInterval(() => {
      if (!this.isRunning || !this.video) return
      debugEvery('webcam:loop', 30, 'tick', {
        readyState: this.video.readyState,
        w: this.video.videoWidth,
        h: this.video.videoHeight,
        hasCallback: !!this.onFrameCallback,
      })
      if (this.onFrameCallback && this.video.readyState >= 2) {
        this.onFrameCallback(this.video, performance.now())
      }
    }, 1000 / 30)
  }

  stopFrameLoop() {
    if (this.loopId !== null) {
      clearInterval(this.loopId)
      this.loopId = null
    }
  }

  onFrame(callback) {
    this.onFrameCallback = callback
  }

  getVideoElement() {
    return this.video
  }

  isActive() {
    return this.isRunning && this.video !== null && this.video.readyState >= 2
  }

  updateConfig(config) {
    this.config = { ...this.config, ...config }
  }
}
