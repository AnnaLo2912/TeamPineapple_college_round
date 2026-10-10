import { DEFAULT_CONFIG } from '../../shared/types.js'
import { STORAGE_KEYS } from '../../shared/constants.js'

function isSupportedPage(url) {
  if (!url) return false
  return !url.startsWith('chrome://') &&
         !url.startsWith('edge://') &&
         !url.startsWith('about:') &&
         !url.startsWith('chrome-extension://') &&
         !url.startsWith('moz-extension://')
}

export class MessagingBridge {
  constructor() {
    this.messageHandlers = new Map()
    this.pendingRequests = new Map()
    this.requestId = 0

    // Guard against duplicate content-script injection registering twice.
    if (window.__handsfreeMessagingBound) return
    window.__handsfreeMessagingBound = true

    // Content scripts receive messages from the background via chrome.runtime.onMessage
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Ignore messages addressed to the voice module (they use `action`, not `type`).
      if (!message || typeof message.type !== 'string') return false
      this.handleMessage(message, sender, sendResponse)
      return true
    })
  }

  handleMessage(message, sender, sendResponse) {
    const handler = this.messageHandlers.get(message.type)
    if (handler) {
      handler(message)
    }

    if (message.type === 'GET_STATUS') {
      sendResponse({ enabled: true, mode: 'face' })
      return
    }
  }

  onMessage(type, handler) {
    this.messageHandlers.set(type, handler)
  }

  sendToBackground(message) {
    return new Promise((resolve) => {
      const id = ++this.requestId
      this.pendingRequests.set(id, resolve)

      chrome.runtime.sendMessage({ ...message, requestId: id }, (response) => {
        this.pendingRequests.delete(id)
        resolve(response)
      })
    })
  }

  broadcastToContent(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (!tab?.id || !isSupportedPage(tab.url)) return

      chrome.tabs.sendMessage(tab.id, message, () => {
        if (chrome.runtime.lastError) {
          console.debug('Message not delivered:', chrome.runtime.lastError.message)
        }
      })
    })
  }

  async sendToActiveTab(message) {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0]
        if (!tab?.id || !isSupportedPage(tab.url)) {
          resolve()
          return
        }

        chrome.tabs.sendMessage(tab.id, message, () => {
          if (chrome.runtime.lastError) {
            console.debug('Message not delivered:', chrome.runtime.lastError.message)
          }
          resolve()
        })
      })
    })
  }
}

export const messagingBridge = new MessagingBridge()

export async function loadConfig() {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEYS.CONFIG)
    if (result[STORAGE_KEYS.CONFIG]) {
      return { ...DEFAULT_CONFIG, ...result[STORAGE_KEYS.CONFIG] }
    }
  } catch (e) {
    console.warn('Failed to load config from sync storage:', e)
  }
  return DEFAULT_CONFIG
}

export async function saveConfig(config) {
  try {
    await chrome.storage.sync.set({ [STORAGE_KEYS.CONFIG]: config })
  } catch (e) {
    console.warn('Failed to save config:', e)
  }
}

export async function getCalibration(mode) {
  try {
    const key = mode === 'face' ? STORAGE_KEYS.CALIBRATION_FACE : STORAGE_KEYS.CALIBRATION_HAND
    const result = await chrome.storage.sync.get(key)
    return result[key] || null
  } catch {
    return null
  }
}

export async function saveCalibration(mode, data) {
  try {
    const key = mode === 'face' ? STORAGE_KEYS.CALIBRATION_FACE : STORAGE_KEYS.CALIBRATION_HAND
    await chrome.storage.sync.set({ [key]: data })
  } catch (e) {
    console.warn('Failed to save calibration:', e)
  }
}
