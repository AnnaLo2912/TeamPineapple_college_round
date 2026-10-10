import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { TrackingManager } from '@/tracking/trackingManager'
import { CursorOverlay, TargetHighlight } from '@/interaction/CursorOverlay'
import { CalibrationOverlay } from '@/calibration/CalibrationOverlay'
import { calibrationManager } from '@/calibration/calibrationManager'
import { loadConfig } from '@/utils/storage'
import { DEFAULT_CONFIG, type TrackerConfig, type TrackingResult, type Point } from '@/tracking/types'
import { targetDetector, type ClickableElement } from '@/interaction/targetDetector'
import './contentStyle.css'

interface OverlayState {
  position: Point | null
  target: ClickableElement | null
  isDwelling: boolean
  dwellProgress: number
  trackingResult: TrackingResult
  isCalibrating: boolean
  calibrationMode: 'face' | 'hand' | null
  showWebcamPreview: boolean
  isEnabled: boolean
  mode: 'face' | 'hand'
}

const DWELL_TIME = 800
const CLICK_COOLDOWN = 500
const MAGNETIC_RADIUS = 40
const SNAP_STRENGTH = 0.3

let root: ReturnType<typeof createRoot> | null = null
let trackingManager: TrackingManager | null = null
let config: TrackerConfig = DEFAULT_CONFIG
let lastClickTime = 0
let dwellTimeout: ReturnType<typeof setTimeout> | null = null
let dwellStartTime = 0
let currentDwellTarget: ClickableElement | null = null

function App() {
  const [state, setState] = useState<OverlayState>({
    position: null,
    target: null,
    isDwelling: false,
    dwellProgress: 0,
    trackingResult: { cursorPoint: null, confidence: 0 },
    isCalibrating: false,
    calibrationMode: null,
    showWebcamPreview: false,
    isEnabled: true,
    mode: 'face',
  })

  const handleTrackingUpdate = useCallback((result: TrackingResult, mappedPoint: Point | null) => {
    if (!state.isEnabled) return

    setState(prev => {
      const newPosition = mappedPoint
      let newTarget: ClickableElement | null = null
      let newIsDwelling = false
      let newDwellProgress = 0

      if (newPosition) {
        newTarget = targetDetector.getTargetAtPoint(newPosition.x, newPosition.y, 20)
        
        if (newTarget && newTarget !== currentDwellTarget) {
          startDwell(newTarget)
        } else if (!newTarget && currentDwellTarget) {
          cancelDwell()
        }

        if (currentDwellTarget && dwellTimeout) {
          const elapsed = Date.now() - dwellStartTime
          newDwellProgress = Math.min(elapsed / DWELL_TIME, 1)
          newIsDwelling = true
        }
      } else if (currentDwellTarget) {
        cancelDwell()
      }

      return {
        ...prev,
        position: newPosition,
        target: newTarget,
        isDwelling: newIsDwelling,
        dwellProgress: newDwellProgress,
        trackingResult: result,
      }
    })
  }, [state.isEnabled])

  const startDwell = (target: ClickableElement) => {
    currentDwellTarget = target
    dwellStartTime = Date.now()
    dwellTimeout = setTimeout(() => {
      executeClick(target)
      currentDwellTarget = null
      dwellTimeout = null
      dwellStartTime = 0
      setState(prev => ({ ...prev, isDwelling: false, dwellProgress: 0 }))
    }, DWELL_TIME)
  }

  const cancelDwell = () => {
    if (dwellTimeout) {
      clearTimeout(dwellTimeout)
      dwellTimeout = null
    }
    dwellStartTime = 0
    currentDwellTarget = null
  }

  const executeClick = (target: ClickableElement) => {
    const now = Date.now()
    if (now - lastClickTime < CLICK_COOLDOWN) return
    lastClickTime = now

    if (!target.element.isConnected) return

    const rect = target.element.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const currentPos = state.position
    if (currentPos && Math.hypot(currentPos.x - centerX, currentPos.y - centerY) > 30) return

    target.element.click()
    target.element.focus()
  }


  const startCalibration = useCallback((mode: 'face' | 'hand') => {
    setState(prev => ({ ...prev, isCalibrating: true, calibrationMode: mode }))
  }, [])

  const cancelCalibration = useCallback(() => {
    calibrationManager.cancelCalibration()
    setState(prev => ({ ...prev, isCalibrating: false, calibrationMode: null }))
  }, [])

  const handleTrackingToggle = useCallback(() => {
    setState(prev => {
      const newEnabled = !prev.isEnabled
      if (!newEnabled) {
        cancelDwell()
        trackingManager?.stop()
      } else {
        trackingManager?.start()
      }
      return { ...prev, isEnabled: newEnabled }
    })
  }, [])

  const handleRecenter = useCallback(() => {
    if (trackingManager && state.trackingResult.cursorPoint) {
      const recentered = calibrationManager.recenter(state.trackingResult.cursorPoint)
      if (recentered && trackingManager) {
        trackingManager.getCoordinateMapper().setCalibration(recentered)
      }
    }
  }, [state.trackingResult.cursorPoint])

  const handleModeChange = useCallback(async (newMode: 'face' | 'hand') => {
    if (!trackingManager) return
    await trackingManager.setMode(newMode)
    setState(prev => ({ ...prev, mode: newMode }))
    const cal = calibrationManager.getCalibration(newMode)
    if (cal) {
      trackingManager.getCoordinateMapper().setCalibration(cal)
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      config = await loadConfig()
      trackingManager = new TrackingManager(config)
      await trackingManager.initialize()
      trackingManager.setMode(config.mode)
      trackingManager.onUpdate(handleTrackingUpdate)
      
      const savedCal = calibrationManager.getCalibration(config.mode)
      if (savedCal) {
        trackingManager.getCoordinateMapper().setCalibration(savedCal)
      }
      
      await trackingManager.start()
      setState(prev => ({ ...prev, mode: config.mode, isEnabled: true }))
    }
    init()

    return () => {
      trackingManager?.dispose()
      cancelDwell()
      targetDetector.destroy()
    }
  }, [handleTrackingUpdate])

  useEffect(() => {
    const handleMessage = (
      message: { type: string; mode?: 'face' | 'hand'; enabled?: boolean },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: { enabled: boolean; mode: 'face' | 'hand' }) => void
    ) => {
      if (message.type === 'TOGGLE_TRACKING') {
        handleTrackingToggle()
      } else if (message.type === 'RECENTER') {
        handleRecenter()
      } else if (message.type === 'START_CALIBRATION') {
        if (message.mode) {
          startCalibration(message.mode)
        }
      } else if (message.type === 'SET_MODE') {
        if (message.mode) {
          handleModeChange(message.mode)
        }
      } else if (message.type === 'GET_STATUS') {
        sendResponse({ enabled: state.isEnabled, mode: state.mode })
      }
      return true
    }

    chrome.runtime.onMessage.addListener(handleMessage)
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage)
    }
  }, [handleTrackingToggle, handleRecenter, startCalibration, handleModeChange, state.isEnabled, state.mode])

  if (!state.isEnabled) {
    return (
      <div className="handsfree-disabled-badge" style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 2147483647,
        padding: '10px 16px',
        background: 'rgba(30, 30, 30, 0.95)',
        color: '#aaa',
        borderRadius: '8px',
        fontSize: '13px',
        fontFamily: 'system-ui, sans-serif',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#666' }} />
        Handsfree: Paused (Alt+H to resume)
      </div>
    )
  }

  return (
    <>
      <CursorOverlay
        position={state.position}
        isDwelling={state.isDwelling}
        dwellProgress={state.dwellProgress}
        target={state.target}
        mode={state.mode}
        magneticRadius={MAGNETIC_RADIUS}
        snapStrength={SNAP_STRENGTH}
        onClick={executeClick}
        onDwellComplete={executeClick}
      />
      <TargetHighlight target={state.target} />
      
      {state.isCalibrating && state.calibrationMode && (
        <CalibrationOverlay
          mode={state.calibrationMode}
          onCancel={cancelCalibration}
          onComplete={() => {
            setState(prev => ({ ...prev, isCalibrating: false, calibrationMode: null }))
          }}
        />
      )}

      {config.showWebcamPreview && trackingManager && (
        <WebcamPreview 
          video={trackingManager.getWebcamManager().getVideoElement()} 
          landmarks={state.trackingResult.landmarks}
          mode={state.mode}
        />
      )}
    </>
  )
}

const WebcamPreview: React.FC<{ 
  video: HTMLVideoElement | null
  landmarks: Point[] | undefined
  mode: 'face' | 'hand'
}> = ({ video, landmarks, mode }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dimensions, setDimensions] = useState({ width: 160, height: 120 })

  useEffect(() => {
    if (!video || !canvasRef.current) return
    const draw = () => {
      if (!video || video.readyState < 2) return
      const canvas = canvasRef.current!
      const ctx = canvas.getContext('2d')!
      
      const scale = Math.min(160 / video.videoWidth, 120 / video.videoHeight)
      const width = video.videoWidth * scale
      const height = video.videoHeight * scale
      
      canvas.width = width
      canvas.height = height
      setDimensions({ width, height })
      
      ctx.save()
      ctx.translate(width, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(video, 0, 0, width, height)
      ctx.restore()

      if (landmarks && landmarks.length > 0) {
        ctx.strokeStyle = mode === 'face' ? '#4ecdc4' : '#ffe66d'
        ctx.lineWidth = 1
        ctx.fillStyle = mode === 'face' ? '#4ecdc4' : '#ffe66d'
        
        landmarks.forEach((p) => {
          const x = width - p.x * width
          const y = p.y * height
          ctx.beginPath()
          ctx.arc(x, y, 2, 0, Math.PI * 2)
          ctx.fill()
        })
      }
      
      requestAnimationFrame(draw)
    }
    draw()
  }, [video, landmarks, mode])

  if (!video) return null

  return (
    <div className="handsfree-webcam-preview" style={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      zIndex: 2147483646,
      width: dimensions.width,
      height: dimensions.height,
      borderRadius: '8px',
      overflow: 'hidden',
      background: '#111',
      border: '1px solid rgba(255,255,255,0.1)',
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
    }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      <div style={{
        position: 'absolute',
        top: 6,
        left: 8,
        fontSize: '10px',
        color: 'rgba(255,255,255,0.6)',
        fontFamily: 'system-ui, sans-serif',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}>
        {mode === 'face' ? 'Face' : 'Hand'} Tracking
      </div>
    </div>
  )
}

function mountOverlay() {
  const container = document.createElement('div')
  container.id = 'handsfree-overlay-root'
  document.body.appendChild(container)
  root = createRoot(container)
  root.render(<App />)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountOverlay)
} else {
  mountOverlay()
}
export {}