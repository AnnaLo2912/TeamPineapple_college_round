import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { STORAGE_KEYS } from '../shared/constants.js'

const Popup = () => {
  const [state, setState] = useState({
    isEnabled: true,
    mode: 'face',
    sensitivity: 2.2,
    smoothing: 0.15,
    deadZone: 0.01,
    dwellTime: 2500,
    edgeScroll: true,
    snapStrength: 0.75,
    magneticRadius: 64,
    padSpeed: 22,
    hasFaceCalibration: false,
    hasHandCalibration: false,
    unsupportedPage: false,
  })

  useEffect(() => {
    const init = async () => {
      const config = await loadConfig()
      const faceCal = await getCalibration('face')
      const handCal = await getCalibration('hand')

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0]
        const unsupported = Boolean(!tab?.id ||
          tab.url?.startsWith('chrome://') ||
          tab.url?.startsWith('edge://') ||
          tab.url?.startsWith('about:') ||
          tab.url?.startsWith('chrome-extension://') ||
          tab.url?.startsWith('moz-extension://'))

        setState(prev => ({
          ...prev,
          mode: config.mode,
          sensitivity: config.sensitivity,
          smoothing: config.smoothing,
          deadZone: config.deadZone,
          dwellTime: config.dwellTime,
          edgeScroll: config.edgeScroll ?? true,
          snapStrength: config.snapStrength ?? 0.75,
          magneticRadius: config.magneticRadius ?? 64,
          padSpeed: config.padSpeed ?? 22,
          hasFaceCalibration: !!faceCal?.matrix,
          hasHandCalibration: !!handCal?.matrix,
          unsupportedPage: unsupported,
        }))
      })
    }
    init()

    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
      if (chrome.runtime.lastError || !status) return
      setState(prev => ({
        ...prev,
        isEnabled: !!status.enabled,
        mode: status.mode || prev.mode,
      }))
    })

    const handleStatusUpdate = (message) => {
      if (message.type === 'STATUS_UPDATE') {
        setState(prev => ({
          ...prev,
          isEnabled: message.enabled,
          mode: message.mode,
        }))
      }
    }

    chrome.runtime.onMessage.addListener(handleStatusUpdate)
    return () => {
      chrome.runtime.onMessage.removeListener(handleStatusUpdate)
    }
  }, [])

  const sendMessage = (type, payload) => {
    chrome.runtime.sendMessage({ type, ...payload })
  }

  const updateConfig = async (updates) => {
    const config = await loadConfig()
    const newConfig = { ...config, ...updates }
    await saveConfig(newConfig)
    setState(prev => ({ ...prev, ...updates }))
    sendMessage('CONFIG_UPDATE', { config: newConfig })
  }

  const toggleEnabled = () => {
    setState(prev => {
      const newEnabled = !prev.isEnabled
      sendMessage('TOGGLE_TRACKING', { enabled: newEnabled })
      return { ...prev, isEnabled: newEnabled }
    })
  }

  const changeMode = async (newMode) => {
    await updateConfig({ mode: newMode })
    sendMessage('SET_MODE', { mode: newMode })
    const cal = await getCalibration(newMode)
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

  const handleCalibrate = (mode) => {
    sendMessage('START_CALIBRATION', { mode })
    window.close()
  }

  const handleClearCalibration = async (mode) => {
    const key = mode === 'face' ? STORAGE_KEYS.CALIBRATION_FACE : STORAGE_KEYS.CALIBRATION_HAND
    await chrome.storage.sync.remove(key)
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

      {state.unsupportedPage && (
        <div style={styles.unsupportedBanner}>
          <span>⚠</span>
          <span>Extension doesn't work on this page (chrome://, settings, etc.)</span>
          <span>Navigate to a regular website to use Handsfree</span>
        </div>
      )}

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
            <div style={styles.row}>
              <span style={styles.label}>Click dwell</span>
              <input
                type="range"
                min="800"
                max="4000"
                step="100"
                value={state.dwellTime}
                onChange={(e) => updateConfig({ dwellTime: parseFloat(e.target.value) })}
                style={styles.slider}
                disabled={!state.isEnabled}
              />
              <span style={styles.value}>{(state.dwellTime / 1000).toFixed(1)}s</span>
            </div>
          </div>

          <div style={styles.section}>
            <div style={styles.row}>
              <span style={styles.label}>Snap strength</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={state.snapStrength}
                onChange={(e) => updateConfig({ snapStrength: parseFloat(e.target.value) })}
                style={styles.slider}
                disabled={!state.isEnabled}
              />
              <span style={styles.value}>{Math.round(state.snapStrength * 100)}%</span>
            </div>
          </div>

          <div style={styles.section}>
            <div style={styles.row}>
              <span style={styles.label}>Snap radius</span>
              <input
                type="range"
                min="20"
                max="140"
                step="4"
                value={state.magneticRadius}
                onChange={(e) => updateConfig({ magneticRadius: parseFloat(e.target.value) })}
                style={styles.slider}
                disabled={!state.isEnabled}
              />
              <span style={styles.value}>{state.magneticRadius}px</span>
            </div>
          </div>

          <div style={styles.section}>
            <div style={styles.row}>
              <span style={styles.label}>Pad speed</span>
              <input
                type="range"
                min="6"
                max="40"
                step="1"
                value={state.padSpeed}
                onChange={(e) => updateConfig({ padSpeed: parseFloat(e.target.value) })}
                style={styles.slider}
                disabled={!state.isEnabled}
              />
              <span style={styles.value}>{state.padSpeed}</span>
            </div>
          </div>

          <div style={styles.section}>
            <label style={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={state.edgeScroll}
                onChange={(e) => updateConfig({ edgeScroll: e.target.checked })}
                style={styles.toggleInput}
              />
              <span style={styles.toggleText}>Continuous scrolling</span>
              <span style={state.edgeScroll ? styles.statusActive : styles.statusInactive}>
                {state.edgeScroll ? 'On' : 'Off'}
              </span>
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
            <button
              style={{
                ...styles.actionButton,
                marginTop: 8,
                background: 'linear-gradient(135deg, #10b981, #059669)',
                color: '#022c22',
                fontWeight: 700,
              }}
              onClick={() => {
                fetch('http://localhost:5173/', { mode: 'no-cors' })
                  .then(() => chrome.tabs.create({ url: 'http://localhost:5173/' }))
                  .catch(() => chrome.tabs.create({ url: chrome.runtime.getURL('evaluation.html') }))
              }}
            >
              📊 Performance Benchmark (Req 8)
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
          <kbd style={styles.kbd}>🕹</kbd>
          <span>Left dock: glide cursor / scroll</span>
        </div>
        <div style={styles.shortcut}>
          <kbd style={styles.kbd}>Dwell</kbd>
          <span>Click ({(state.dwellTime / 1000).toFixed(1)}s)</span>
        </div>
      </div>
    </div>
  )
}

async function loadConfig() {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEYS.CONFIG)
    if (result[STORAGE_KEYS.CONFIG]) {
      return { ...DEFAULT_CONFIG, ...result[STORAGE_KEYS.CONFIG] }
    }
  } catch (e) {
    console.warn('Failed to load config:', e)
  }
  return DEFAULT_CONFIG
}

async function saveConfig(config) {
  try {
    await chrome.storage.sync.set({ [STORAGE_KEYS.CONFIG]: config })
  } catch (e) {
    console.warn('Failed to save config:', e)
  }
}

async function getCalibration(mode) {
  try {
    const key = mode === 'face' ? STORAGE_KEYS.CALIBRATION_FACE : STORAGE_KEYS.CALIBRATION_HAND
    const result = await chrome.storage.sync.get(key)
    return result[key] || null
  } catch {
    return null
  }
}

const DEFAULT_CONFIG = {
  mode: 'face',
  sensitivity: 2.2,
  deadZone: 0.01,
  smoothing: 0.15,
  showWebcamPreview: false,
  magneticRadius: 64,
  snapStrength: 0.75,
  dwellTime: 2500,
  edgeScroll: true,
  edgeScrollBand: 0.15,
  padSpeed: 22,
}

const styles = {
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
  unsupportedBanner: {
    margin: '12px 20px 0',
    padding: '12px 16px',
    background: 'rgba(255, 170, 0, 0.15)',
    border: '1px solid rgba(255, 170, 0, 0.3)',
    borderRadius: '8px',
    color: '#ffaa00',
    fontSize: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
}

function mountPopup() {
  const root = createRoot(document.getElementById('root'))
  root.render(<Popup />)
}

document.addEventListener('DOMContentLoaded', mountPopup)
