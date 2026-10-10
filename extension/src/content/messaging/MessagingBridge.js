import { DEFAULT_CONFIG } from '../../shared/types.js'
import { STORAGE_KEYS } from '../../shared/constants.js'
import { isSupportedPage, getBrowserAPI } from '../../shared/browserUtils.js'

const api = getBrowserAPI() || chrome

export class MessagingBridge {
  constructor() {
    this.messageHandlers = new Map()
    this.pendingRequests = new Map()
    this.requestId = 0

    // Content scripts receive messages from the background via runtime.onMessage
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

      api.runtime.sendMessage({ ...message, requestId: id }, (response) => {
        this.pendingRequests.delete(id)
        resolve(response)
      })
    })
  }

  broadcastToContent(message) {
    if (!api.tabs?.query) return
    api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (!tab?.id || !isSupportedPage(tab.url)) return

      api.tabs.sendMessage(tab.id, message, () => {
        if (api.runtime.lastError) {
          console.debug('Message not delivered:', api.runtime.lastError.message)
        }
      })
    })
  }

  async sendToActiveTab(message) {
    return new Promise((resolve) => {
      if (!api.tabs?.query) {
        resolve()
        return
      }
      api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0]
        if (!tab?.id || !isSupportedPage(tab.url)) {
          resolve()
          return
        }

        api.tabs.sendMessage(tab.id, message, () => {
          if (api.runtime.lastError) {
            console.debug('Message not delivered:', api.runtime.lastError.message)
          }
          resolve()
        })
      })
    })
  }
}

export const messagingBridge = new MessagingBridge()

function getStorage() {
  return api.storage?.sync || api.storage?.local
}

export async function loadConfig() {
  try {
    const storage = getStorage()
    if (storage) {
      const result = await storage.get(STORAGE_KEYS.CONFIG)
      if (result && result[STORAGE_KEYS.CONFIG]) {
        return { ...DEFAULT_CONFIG, ...result[STORAGE_KEYS.CONFIG] }
      }
    }
  } catch (e) {
    console.warn('Failed to load config from storage:', e)
  }
  return DEFAULT_CONFIG
}

export async function saveConfig(config) {
  try {
    const storage = getStorage()
    if (storage) {
      await storage.set({ [STORAGE_KEYS.CONFIG]: config })
    }
  } catch (e) {
    console.warn('Failed to save config:', e)
  }
}

export async function getCalibration(mode) {
  try {
    const storage = getStorage()
    if (!storage) return null
    const key = mode === 'face' ? STORAGE_KEYS.CALIBRATION_FACE : STORAGE_KEYS.CALIBRATION_HAND
    const result = await storage.get(key)
    return result[key] || null
  } catch {
    return null
  }
}

export async function saveCalibration(mode, data) {
  try {
    const storage = getStorage()
    if (storage) {
      const key = mode === 'face' ? STORAGE_KEYS.CALIBRATION_FACE : STORAGE_KEYS.CALIBRATION_HAND
      await storage.set({ [key]: data })
    }
  } catch (e) {
    console.warn('Failed to save calibration:', e)
  }
}
