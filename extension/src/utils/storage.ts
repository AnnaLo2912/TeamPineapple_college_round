import type { TrackerConfig } from '../tracking/types'

const STORAGE_KEY = 'handsfree_config'
const DEFAULT_CONFIG: TrackerConfig = {
  mode: 'face',
  sensitivity: 1.5,
  deadZone: 0.02,
  smoothing: 0.15,
  showWebcamPreview: false,
}

export async function loadConfig(): Promise<TrackerConfig> {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEY)
    if (result[STORAGE_KEY]) {
      return { ...DEFAULT_CONFIG, ...result[STORAGE_KEY] }
    }
  } catch (e) {
    console.warn('Failed to load config from sync storage, trying local:', e)
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY)
      if (result[STORAGE_KEY]) {
        return { ...DEFAULT_CONFIG, ...result[STORAGE_KEY] }
      }
    } catch (e2) {
      console.warn('Failed to load config from local storage:', e2)
    }
  }
  return DEFAULT_CONFIG
}

export async function saveConfig(config: TrackerConfig): Promise<void> {
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: config })
  } catch (e) {
    console.warn('Failed to save to sync storage, trying local:', e)
    await chrome.storage.local.set({ [STORAGE_KEY]: config })
  }
}

export async function getCalibration(mode: 'face' | 'hand'): Promise<any | null> {
  try {
    const result = await chrome.storage.sync.get(`handsfree_calibration_${mode}`)
    return result[`handsfree_calibration_${mode}`] || null
  } catch {
    return null
  }
}

export async function saveCalibration(mode: 'face' | 'hand', data: any): Promise<void> {
  try {
    await chrome.storage.sync.set({ [`handsfree_calibration_${mode}`]: data })
  } catch (e) {
    await chrome.storage.local.set({ [`handsfree_calibration_${mode}`]: data })
  }
}