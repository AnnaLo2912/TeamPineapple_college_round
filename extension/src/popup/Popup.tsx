import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { loadConfig, saveConfig } from '../utils/storage'
import { calibrationManager } from '../calibration/calibrationManager'
import type { TrackerConfig } from '../tracking/types'

interface PopupState {
  isEnabled: boolean
  mode: 'face' | 'hand'
  sensitivity: number
  smoothing: number
  deadZone: number
  showPreview: boolean
  hasFaceCalibration: boolean
  hasHandCalibration: boolean
}

const Popup: React.FC = () => {
  const [state, setState] = useState<PopupState>({
    isEnabled: true,
    mode: 'face',
    sensitivity: 1.5,
    smoothing: 0.15,
    deadZone: 0.02,
    showPreview: false,
    hasFaceCalibration: false,
    hasHandCalibration: false,
  })

  useEffect(() => {
    const init = async () => {
      const config = await loadConfig()
      const faceCal = calibrationManager.getCalibration('face')
      const handCal = calibrationManager.getCalibration('hand')
      setState(prev => ({
        ...prev,
        mode: config.mode,
        sensitivity: config.sensitivity,
        smoothing: config.smoothing,
        deadZone: config.deadZone,
        showPreview: config.showWebcamPreview,
        hasFaceCalibration: !!faceCal?.matrix,
        hasHandCalibration: !!handCal?.matrix,
      }))
    }
    init()
  }, [])

  const sendMessage = (type: string, payload?: any) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type, ...payload })
      }
    })
  }

  const updateConfig = async (updates: Partial<TrackerConfig>) => {
    const config = await loadConfig()
    const newConfig = { ...config, ...updates }
    await saveConfig(newConfig)
    setState(prev => ({ ...prev, ...updates }))
    sendMessage('CONFIG_UPDATE', newConfig)
  }

  const toggleEnabled = () => {
    setState(prev => {
      const newEnabled = !prev.isEnabled
      sendMessage('TOGGLE_TRACKING', { enabled: newEnabled })
      return { ...prev, isEnabled: newEnabled }
    })
  }

  const changeMode = async (newMode: 'face' | 'hand') => {
    await updateConfig({ mode: newMode })
    sendMessage('SET_MODE', { mode: newMode })
    const cal = calibrationManager.getCalibration(newMode)
    setState(prev => ({ 
      ...prev, 
      mode: newMode,
      hasFaceCalibration: newMode === 'face' ? !!cal?.matrix : prev.hasFaceCalibration,
      hasHandCalibration: newMode === 'hand' ? !!cal?.matrix : prev.hasHandCalibration,
    }))
  }

  const handleRecenter = () => {
    sendMessage('RECENTER')
  }

  const handleCalibrate = (mode: 'face' | 'hand') => {
    sendMessage('START_CALIBRATION', { mode })
    window.close()
  }

  const handleClearCalibration = async (mode: 'face' | 'hand') => {
    calibrationManager.clearCalibration(mode)
    setState(prev => ({
      ...prev,
      hasFaceCalibration: mode === 'face' ? false : prev.hasFaceCalibration,
      hasHandCalibration: mode === 'hand' ? false : prev.hasHandCalibration,
    }))
    sendMessage('CLEAR_CALIBRATION', { mode })
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.logo}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z" />
            <path d="M12 6v6l4 2" />
          </svg>
        </div>
        <div>
          <h1 style={styles.title}>Handsfree</h1>
          <span style={styles.subtitle}>Webcam-based browsing</span>
        </div>
      </div>

      <div style={styles.section}>
        <label style={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={state.isEnabled}
            onChange={toggleEnabled}
            style={styles.toggleInput}
          />
          <span style={styles.toggleText}>Tracking Enabled</span>
          <span style={state.isEnabled ? styles.statusActive : styles.statusInactive}>
            {state.isEnabled ? 'Active' : 'Paused'}
          </span>
        </label>
      </div>

      <div style={styles.section}>
        <div style={styles.row}>
          <span style={styles.label}>Mode</span>
          <div style={styles.modeToggle}>
            <button
              style={state.mode === 'face' ? styles.modeButtonActive : styles.modeButton}
              onClick={() => changeMode('face')}
              disabled={!state.isEnabled}
            >
              <span style={styles.modeIcon}>👁️</span>
              Face
              {state.hasFaceCalibration && <span style={styles.calibratedBadge} title="Calibrated">✓</span>}
            </button>
            <button
              style={state.mode === 'hand' ? styles.modeButtonActive : styles.modeButton}
              onClick={() => changeMode('hand')}
              disabled={!state.isEnabled}
            >
              <span style={styles.modeIcon}>✋</span>
              Hand
              {state.hasHandCalibration && <span style={styles.calibratedBadge} title="Calibrated">✓</span>}
            </button>
          </div>
        </div>
      </div>

      {state.isEnabled && (
        <>
          <div style={styles.section}>
            <div style={styles.row}>
              <span style={styles.label}>Sensitivity</span>
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.1"
                value={state.sensitivity}
                onChange={(e) => updateConfig({ sensitivity: parseFloat(e.target.value) })}
                style={styles.slider}
                disabled={!state.isEnabled}
              />
              <span style={styles.value}>{state.sensitivity.toFixed(1)}x</span>
            </div>
          </div>

          <div style={styles.section}>
            <div style={styles.row}>
              <span style={styles.label}>Smoothing</span>
              <input
                type="range"
                min="0.05"
                max="0.5"
                step="0.05"
                value={state.smoothing}
                onChange={(e) => updateConfig({ smoothing: parseFloat(e.target.value) })}
                style={styles.slider}
                disabled={!state.isEnabled}
              />
              <span style={styles.value}>{state.smoothing.toFixed(2)}</span>
            </div>
          </div>

          <div style={styles.section}>
            <div style={styles.row}>
              <span style={styles.label}>Dead Zone</span>
              <input
                type="range"
                min="0"
                max="0.1"
                step="0.01"
                value={state.deadZone}
                onChange={(e) => updateConfig({ deadZone: parseFloat(e.target.value) })}
                style={styles.slider}
                disabled={!state.isEnabled}
              />
              <span style={styles.value}>{(state.deadZone * 100).toFixed(0)}%</span>
            </div>
          </div>

          <div style={styles.section}>
            <label style={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={state.showPreview}
                onChange={(e) => updateConfig({ showWebcamPreview: e.target.checked })}
                style={styles.toggleInput}
                disabled={!state.isEnabled}
              />
              <span style={styles.toggleText}>Webcam Preview</span>
            </label>
          </div>

          <div style={styles.section}>
            <div style={styles.row}>
              <span style={styles.label}>Calibration</span>
              <div style={styles.calibrationButtons}>
                <button
                  style={styles.calibrateButton}
                  onClick={() => handleCalibrate('face')}
                  disabled={!state.isEnabled || state.mode !== 'face'}
                >
                  Calibrate Face
                </button>
                <button
                  style={styles.calibrateButton}
                  onClick={() => handleCalibrate('hand')}
                  disabled={!state.isEnabled || state.mode !== 'hand'}
                >
                  Calibrate Hand
                </button>
              </div>
            </div>
            {(state.hasFaceCalibration || state.hasHandCalibration) && (
              <div style={styles.clearCalibration}>
                <button
                  style={styles.clearButton}
                  onClick={() => handleClearCalibration('face')}
                  disabled={!state.hasFaceCalibration}
                >
                  Clear Face Calibration
                </button>
                <button
                  style={styles.clearButton}
                  onClick={() => handleClearCalibration('hand')}
                  disabled={!state.hasHandCalibration}
                >
                  Clear Hand Calibration
                </button>
              </div>
            )}
          </div>

          <div style={styles.section}>
            <button style={styles.actionButton} onClick={handleRecenter} disabled={!state.isEnabled}>
              Recenter (Alt+R)
            </button>
          </div>
        </>
      )}

      <div style={styles.shortcuts}>
        <div style={styles.shortcut}>
          <kbd style={styles.kbd}>Alt+H</kbd>
          <span>Toggle Tracking</span>
        </div>
        <div style={styles.shortcut}>
          <kbd style={styles.kbd}>Alt+R</kbd>
          <span>Recenter</span>
        </div>
        <div style={styles.shortcut}>
          <kbd style={styles.kbd}>Dwell</kbd>
          <span>Click (800ms)</span>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 300,
    minHeight: 400,
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
    color: '#eaeaea',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    borderRadius: '0',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '16px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(0,0,0,0.2)',
  },
  logo: {
    color: '#4ecdc4',
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 600,
    letterSpacing: '-0.5px',
  },
  subtitle: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  section: {
    padding: '16px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.7)',
    minWidth: 90,
  },
  value: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#4ecdc4',
    fontVariantNumeric: 'tabular-nums',
    minWidth: 40,
    textAlign: 'right',
  },
  slider: {
    flex: 1,
    accentColor: '#4ecdc4',
    height: 4,
    borderRadius: 2,
  },
  toggleLabel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
    gap: 12,
  },
  toggleInput: {
    width: '18px',
    height: '18px',
    accentColor: '#4ecdc4',
    cursor: 'pointer',
  },
  toggleText: {
    fontSize: '14px',
    fontWeight: 500,
    flex: 1,
  },
  statusActive: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#4ecdc4',
    background: 'rgba(78, 205, 196, 0.15)',
    padding: '2px 8px',
    borderRadius: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  statusInactive: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#888',
    background: 'rgba(255,255,255,0.08)',
    padding: '2px 8px',
    borderRadius: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  modeToggle: {
    display: 'flex',
    gap: 8,
  },
  modeButton: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: 'rgba(255,255,255,0.7)',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  modeButtonActive: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '10px 12px',
    background: 'linear-gradient(135deg, rgba(78,205,196,0.2), rgba(78,205,196,0.1))',
    border: '1px solid rgba(78,205,196,0.4)',
    borderRadius: '8px',
    color: '#4ecdc4',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  modeIcon: {
    fontSize: '14px',
  },
  calibratedBadge: {
    fontSize: '10px',
    background: 'rgba(78,205,196,0.2)',
    color: '#4ecdc4',
    padding: '1px 5px',
    borderRadius: '8px',
    fontWeight: 600,
  },
  calibrationButtons: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  calibrateButton: {
    flex: 1,
    minWidth: 0,
    padding: '8px 12px',
    background: 'rgba(78,205,196,0.15)',
    border: '1px solid rgba(78,205,196,0.3)',
    borderRadius: '8px',
    color: '#4ecdc4',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  clearCalibration: {
    marginTop: 10,
    display: 'flex',
    gap: 8,
  },
  clearButton: {
    flex: 1,
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '11px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  actionButton: {
    width: '100%',
    padding: '10px 16px',
    background: 'linear-gradient(135deg, #4ecdc4, #2a9d8f)',
    border: 'none',
    borderRadius: '8px',
    color: '#0d1b2a',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  shortcuts: {
    padding: '16px 20px',
    background: 'rgba(0,0,0,0.2)',
    borderTop: '1px solid rgba(255,255,255,0.04)',
  },
  shortcut: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 0',
    fontSize: '12px',
  },
  kbd: {
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '4px',
    padding: '2px 8px',
    fontSize: '11px',
    fontFamily: 'inherit',
    fontWeight: 500,
    color: '#4ecdc4',
    minWidth: 50,
    textAlign: 'center',
  },
}

function mountPopup() {
  const root = createRoot(document.getElementById('root')!)
  root.render(<Popup />)
}

document.addEventListener('DOMContentLoaded', mountPopup)