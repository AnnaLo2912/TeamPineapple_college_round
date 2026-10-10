import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { targetDetector, type ClickableElement } from './targetDetector'

interface CursorOverlayProps {
  position: { x: number; y: number } | null
  isDwelling: boolean
  dwellProgress: number
  target: ClickableElement | null
  mode: 'face' | 'hand'
  magneticRadius: number
  snapStrength: number
  onClick: (element: ClickableElement) => void
  onDwellComplete: (element: ClickableElement) => void
}

const CURSOR_SIZE = 24
const DWELL_RING_SIZE = 40
const DWELL_TIME = 800

export const CursorOverlay: React.FC<CursorOverlayProps> = ({
  position,
  isDwelling,
  dwellProgress,
  target,
  mode,
  magneticRadius,
  snapStrength,
  onClick,
  onDwellComplete,
}) => {
  const [displayPosition, setDisplayPosition] = useState<{ x: number; y: number } | null>(null)
  const [magneticTarget, setMagneticTarget] = useState<ClickableElement | null>(null)
  const [showCursor, setShowCursor] = useState(true)
  const animationRef = useRef<number>()

  const applyMagneticSnap = useCallback((pos: { x: number; y: number }) => {
    const snapped = targetDetector.applyMagneticSnap(pos.x, pos.y, magneticRadius, snapStrength)
    return snapped || pos
  }, [magneticRadius, snapStrength])

  useEffect(() => {
    if (!position) {
      setDisplayPosition(null)
      setMagneticTarget(null)
      return
    }

    const snappedPos = applyMagneticSnap(position)
    setDisplayPosition(snappedPos)

    const magTarget = targetDetector.getMagneticTarget(position.x, position.y, magneticRadius)
    setMagneticTarget(magTarget)
  }, [position, applyMagneticSnap, magneticRadius])

  useEffect(() => {
    if (!isDwelling || !target) return

    const startTime = Date.now()
    const animate = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / DWELL_TIME, 1)
      
      if (progress >= 1) {
        onDwellComplete(target)
        return
      }
      
      animationRef.current = requestAnimationFrame(animate)
    }
    
    animationRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationRef.current!)
  }, [isDwelling, target, onDwellComplete])

  if (!displayPosition || !showCursor) return null

  const cursorStyle: React.CSSProperties = {
    position: 'fixed',
    left: displayPosition.x - CURSOR_SIZE / 2,
    top: displayPosition.y - CURSOR_SIZE / 2,
    width: CURSOR_SIZE,
    height: CURSOR_SIZE,
    pointerEvents: 'none',
    zIndex: 2147483647,
    transform: 'translateZ(0)',
    willChange: 'transform, left, top',
  }

  const isOverTarget = target !== null
  const cursorColor = isOverTarget ? '#ff6b6b' : mode === 'face' ? '#4ecdc4' : '#ffe66d'

  return createPortal(
    <div style={cursorStyle} className="handsfree-cursor">
      <svg width={CURSOR_SIZE} height={CURSOR_SIZE} viewBox="0 0 24 24" style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id="cursorGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={cursorColor} stopOpacity={0.9} />
            <stop offset="70%" stopColor={cursorColor} stopOpacity={0.6} />
            <stop offset="100%" stopColor={cursorColor} stopOpacity={0.2} />
          </radialGradient>
          <filter id="cursorGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        
        <circle
          cx="12"
          cy="12"
          r="10"
          fill="url(#cursorGradient)"
          filter="url(#cursorGlow)"
          stroke={cursorColor}
          strokeWidth="1.5"
          strokeOpacity={0.5}
        />
        
        <circle cx="12" cy="12" r="3" fill="white" opacity={0.8} />
        
        {isOverTarget && (
          <circle
            cx="12"
            cy="12"
            r={14 + Math.sin(Date.now() / 100) * 2}
            fill="none"
            stroke={cursorColor}
            strokeWidth="1.5"
            strokeOpacity={0.6}
            strokeDasharray="4 4"
          />
        )}

        {isDwelling && (
          <svg x={-DWELL_RING_SIZE / 2} y={-DWELL_RING_SIZE / 2} width={DWELL_RING_SIZE} height={DWELL_RING_SIZE}>
            <circle
              cx={DWELL_RING_SIZE / 2}
              cy={DWELL_RING_SIZE / 2}
              r={DWELL_RING_SIZE / 2 - 3}
              fill="none"
              stroke="#4ecdc4"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${(DWELL_RING_SIZE - 6) * Math.PI * 2 * dwellProgress} ${(DWELL_RING_SIZE - 6) * Math.PI * 2}`}
              strokeDashoffset={0}
              transform={`rotate(-90 ${DWELL_RING_SIZE / 2} ${DWELL_RING_SIZE / 2})`}
              style={{ transition: 'stroke-dasharray 50ms linear' }}
            />
          </svg>
        )}
      </svg>

      {magneticTarget && (
        <div
          style={{
            position: 'absolute',
            left: magneticTarget.center.x - displayPosition.x,
            top: magneticTarget.center.y - displayPosition.y,
            width: 'max(120px, auto)',
            padding: '4px 8px',
            background: 'rgba(0, 0, 0, 0.85)',
            color: 'white',
            borderRadius: '4px',
            fontSize: '11px',
            fontFamily: 'system-ui, sans-serif',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 2147483646,
            backdropFilter: 'blur(4px)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          {magneticTarget.tagName.toUpperCase()}{magneticTarget.type ? `[${magneticTarget.type}]` : ''}
          {magneticTarget.isLink && ' → Link'}
        </div>
      )}
    </div>,
    document.body
  )
}

export const TargetHighlight: React.FC<{ target: ClickableElement | null }> = ({ target }) => {
  if (!target) return null

  const { rect } = target
  const padding = 4

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: rect.left - padding,
        top: rect.top - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
        pointerEvents: 'none',
        zIndex: 2147483645,
        borderRadius: '4px',
        boxShadow: '0 0 0 2px #4ecdc4, 0 0 12px 4px rgba(78, 205, 196, 0.4)',
        animation: 'handsfree-pulse 1.5s ease-in-out infinite',
      }}
      className="handsfree-highlight"
    >
      <style jsx>{`
        @keyframes handsfree-pulse {
          0%, 100% { box-shadow: 0 0 0 2px #4ecdc4, 0 0 12px 4px rgba(78, 205, 196, 0.4); }
          50% { box-shadow: 0 0 0 3px #4ecdc4, 0 0 20px 6px rgba(78, 205, 196, 0.6); }
        }
      `}</style>
    </div>,
    document.body
  )
}