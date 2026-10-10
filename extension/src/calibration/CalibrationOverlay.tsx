import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { calibrationManager, type Point } from './calibrationManager'

interface CalibrationOverlayProps {
  mode: 'face' | 'hand'
  onCancel: () => void
  onComplete: () => void
}

const TARGET_SIZE = 32
const PULSE_DURATION = 1500

export const CalibrationOverlay: React.FC<CalibrationOverlayProps> = ({ mode, onCancel, onComplete }) => {
  const [currentPoint, setCurrentPoint] = useState<Point | null>(null)
  const [progress, setProgress] = useState({ current: 0, total: 5 })
  const [pulsePhase, setPulsePhase] = useState(0)
  const animationRef = useRef<number>()

  useEffect(() => {
    const point = calibrationManager.startCalibration(mode, (p) => {
      setCurrentPoint(p.point)
      setProgress({ current: p.current, total: p.total })
    }, (data) => {
      onComplete()
    })
    setCurrentPoint(point)
    setProgress({ current: 1, total: 5 })

    const animate = () => {
      setPulsePhase(prev => (prev + 0.02) % (Math.PI * 2))
      animationRef.current = requestAnimationFrame(animate)
    }
    animationRef.current = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animationRef.current!)
      calibrationManager.cancelCalibration()
    }
  }, [mode, onComplete])

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onCancel()
    if (e.key === 'r' || e.key === 'R') {
      calibrationManager.cancelCalibration()
      onCancel()
    }
  }

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  if (!currentPoint) return null

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const x = currentPoint.x * viewportWidth
  const y = currentPoint.y * viewportHeight
  const pulseScale = 1 + Math.sin(pulsePhase) * 0.15

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        background: 'rgba(0, 0, 0, 0.92)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: 'white',
        cursor: 'crosshair',
      }}
      onClick={onCancel}
      className="handsfree-calibration-overlay"
    >
      <style jsx>{`
        @keyframes handsfree-ring-pulse {
          0% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.3); opacity: 0.2; }
          100% { transform: scale(1); opacity: 0.6; }
        }
        @keyframes handsfree-center-pulse {
          0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(78, 205, 196, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 20px rgba(78, 205, 196, 0); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(78, 205, 196, 0); }
        }
      `}</style>

      <div
        style={{
          position: 'absolute',
          left: x - TARGET_SIZE / 2,
          top: y - TARGET_SIZE / 2,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            width: TARGET_SIZE * 3,
            height: TARGET_SIZE * 3,
            borderRadius: '50%',
            border: '2px solid #4ecdc4',
            opacity: 0.4,
            animation: `handsfree-ring-pulse ${PULSE_DURATION}ms ease-out infinite`,
            transformOrigin: 'center',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: TARGET_SIZE,
            top: TARGET_SIZE,
            width: TARGET_SIZE,
            height: TARGET_SIZE,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 30% 30%, #4ecdc4, #2a9d8f)',
            boxShadow: '0 0 20px rgba(78, 205, 196, 0.8), inset 0 -4px 8px rgba(0,0,0,0.3)',
            transform: `scale(${pulseScale})`,
            transformOrigin: 'center',
            transition: 'transform 100ms ease-out',
          }}
        >
          <div style={{
            position: 'absolute',
            inset: 4,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.3), transparent)',
          }} />
        </div>
      </div>

      <div style={{
        position: 'absolute',
        top: 60,
        left: 0,
        right: 0,
        textAlign: 'center',
      }}>
        <h2 style={{
          margin: 0,
          fontSize: '28px',
          fontWeight: 600,
          letterSpacing: '-0.5px',
        }}>
          {mode === 'face' ? '👁️ Face Calibration' : '✋ Hand Calibration'}
        </h2>
        <p style={{
          margin: '8px 0 0',
          fontSize: '16px',
          opacity: 0.8,
        }}>
          Look at / Point to the pulsing target
        </p>
      </div>

      <div style={{
        position: 'absolute',
        bottom: 80,
        display: 'flex',
        gap: '10px',
        alignItems: 'center',
      }}>
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            style={{
              width: i < progress.current - 1 ? '28px' : '12px',
              height: '12px',
              borderRadius: '6px',
              background: i < progress.current - 1 ? '#4ecdc4' : 'rgba(255,255,255,0.3)',
              transition: 'all 300ms ease',
              boxShadow: i === progress.current - 1 ? '0 0 8px #4ecdc4' : 'none',
            }}
          />
        ))}
        <span style={{
          marginLeft: '12px',
          fontSize: '14px',
          opacity: 0.7,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {progress.current} / {progress.total}
        </span>
      </div>

      <div style={{
        position: 'absolute',
        bottom: 40,
        fontSize: '13px',
        opacity: 0.6,
      }}>
        Press <kbd style={{
          background: 'rgba(255,255,255,0.15)',
          padding: '2px 8px',
          borderRadius: '4px',
          margin: '0 4px',
          fontFamily: 'inherit',
        }}>Esc</kbd> to cancel
      </div>
    </div>,
    document.body
  )
}