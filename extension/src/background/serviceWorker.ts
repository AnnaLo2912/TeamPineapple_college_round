import type { TrackingMode, Point } from '../shared/types'
import { debugLog, debugEvery } from '../shared/debug'

function isSupportedPage(url?: string): boolean {
  if (!url) return false
  return !url.startsWith('chrome://') &&
         !url.startsWith('edge://') &&
         !url.startsWith('about:') &&
         !url.startsWith('chrome-extension://') &&
         !url.startsWith('moz-extension://')
}

// Tabs that currently have the content script loaded.
const activeTabs = new Map<number, { url: string; lastSeen: number }>()

let activeTabId: number | null = null
let trackingEnabled = true
let currentMode: TrackingMode = 'face'
let offscreenCreating: Promise<void> | null = null

debugLog('background', 'service worker loaded')

function registerTab(tabId: number, url: string) {
  if (isSupportedPage(url)) {
    activeTabs.set(tabId, { url, lastSeen: Date.now() })
  }
}

function unregisterTab(tabId: number) {
  activeTabs.delete(tabId)
}

function getActiveTabs(): number[] {
  const now = Date.now()
  const tabs: number[] = []
  activeTabs.forEach((info, tabId) => {
    if (now - info.lastSeen > 5 * 60 * 1000) {
      activeTabs.delete(tabId)
    } else {
      tabs.push(tabId)
    }
  })
  return tabs
}

function forwardToAllTabs(message: any) {
  getActiveTabs().forEach((tabId) => {
    chrome.tabs.sendMessage(tabId, message, () => void chrome.runtime.lastError)
  })
}

function forwardToActiveTab(message: any) {
  let tabId = activeTabId
  if (tabId == null || !activeTabs.has(tabId)) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (tab?.id && isSupportedPage(tab.url)) {
        chrome.tabs.sendMessage(tab.id, message, () => void chrome.runtime.lastError)
      }
    })
    return
  }
  chrome.tabs.sendMessage(tabId, message, () => void chrome.runtime.lastError)
}

function switchTab(direction: -1 | 1) {
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    if (!tabs.length) return
    const sorted = tabs.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    const activePos = sorted.findIndex((t) => t.active)
    let nextPos = activePos < 0 ? 0 : activePos + direction
    if (nextPos >= sorted.length) nextPos = 0
    if (nextPos < 0) nextPos = sorted.length - 1
    const next = sorted[nextPos]
    if (next?.id) {
      activeTabId = next.id
      chrome.tabs.update(next.id, { active: true })
      debugLog('background', 'switchTab', { direction, tabId: next.id })
    }
  })
}

// ---------------------------------------------------------------------------
// Offscreen document management
// ---------------------------------------------------------------------------

async function hasOffscreenDocument(): Promise<boolean> {
  try {
    const runtime = chrome.runtime as unknown as {
      getContexts?: (filter: { contextTypes: string[] }) => Promise<unknown[]>
    }
    if (typeof runtime.getContexts === 'function') {
      const contexts = await runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
      return Array.isArray(contexts) && contexts.length > 0
    }
  } catch {
    // getContexts unavailable on older Chrome; fall through.
  }
  return false
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreenDocument()) return
  if (offscreenCreating) {
    await offscreenCreating
    return
  }

  const offscreen = chrome.offscreen as unknown as {
    createDocument: (options: { url: string; reasons: string[]; justification: string }) => Promise<void>
    closeDocument: () => Promise<void>
  }

  debugLog('background', 'creating offscreen document')
  offscreenCreating = offscreen
    .createDocument({
      url: 'src/offscreen/offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Webcam-based head and hand tracking for accessible browsing',
    })
    .catch((error: any) => {
      const message = String(error?.message || error)
      if (!message.includes('single offscreen')) {
        console.error('Failed to create offscreen document:', message)
      }
    })
    .finally(() => {
      offscreenCreating = null
    })

  await offscreenCreating
}

async function closeOffscreen(): Promise<void> {
  try {
    const offscreen = chrome.offscreen as unknown as { closeDocument: () => Promise<void> }
    await offscreen.closeDocument()
  } catch {
    // Nothing to close.
  }
}

function sendToOffscreen(message: any) {
  chrome.runtime.sendMessage({ ...message, target: 'offscreen' }, () => void chrome.runtime.lastError)
}

async function loadStoredMode(): Promise<TrackingMode> {
  try {
    const result = await chrome.storage.sync.get('handsfree_config')
    const mode = result?.handsfree_config?.mode
    if (mode === 'face' || mode === 'hand') return mode
  } catch {
    // Fall through to default.
  }
  return 'face'
}

async function startTracking() {
  currentMode = await loadStoredMode()
  debugLog('background', 'startTracking', { mode: currentMode })
  await ensureOffscreen()
  sendToOffscreen({ type: 'OFFSCREEN_SET_MODE', mode: currentMode })
  sendToOffscreen({ type: 'OFFSCREEN_START' })
}

async function stopTracking() {
  sendToOffscreen({ type: 'OFFSCREEN_STOP' })
  await closeOffscreen()
}

function setTrackingEnabled(enabled: boolean) {
  trackingEnabled = enabled
  if (enabled) {
    void startTracking()
  } else {
    void stopTracking()
  }
  forwardToAllTabs({ type: 'TOGGLE_TRACKING', enabled, timestamp: Date.now() })
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set({
      handsfree_config: {
        mode: 'face',
        sensitivity: 1.5,
        deadZone: 0.02,
        smoothing: 0.15,
        showWebcamPreview: false,
        magneticRadius: 64,
        snapStrength: 0.75,
        dwellTime: 2500,
        edgeScroll: true,
        edgeScrollBand: 0.15,
      }
    })
  }
})

chrome.tabs.onActivated.addListener((info) => {
  activeTabId = info.tabId
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    registerTab(tabId, tab.url)
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  unregisterTab(tabId)
  if (activeTabId === tabId) activeTabId = null
})

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-tracking') {
    setTrackingEnabled(!trackingEnabled)
  } else if (command === 'recenter') {
    forwardToAllTabs({ type: 'RECENTER', timestamp: Date.now() })
  } else if (command === 'next-tab') {
    switchTab(1)
  } else if (command === 'prev-tab') {
    switchTab(-1)
  }
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_VERSION') {
    sendResponse({ version: chrome.runtime.getManifest().version })
    return true
  }

  if (message.type === 'GET_STATUS') {
    sendResponse({ enabled: trackingEnabled, mode: currentMode })
    return true
  }

  if (message.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage()
    return true
  }

  if (message.type === 'TAB_REGISTER') {
    if (sender.tab?.id && sender.tab.url) {
      registerTab(sender.tab.id, sender.tab.url)
      activeTabId = sender.tab.id
      debugLog('background', 'TAB_REGISTER', { tabId: sender.tab.id, url: sender.tab.url })
    }
    sendResponse({ success: true })
    if (trackingEnabled) {
      void startTracking()
    }
    return true
  }

  // Tracking results originate from the offscreen document.
  if (message.type === 'TRACKING_RESULT') {
    const payload: Point | null = message.rawPoint
    debugEvery('background:track', 15, 'result', {
      hasPoint: payload !== null,
      confidence: message.confidence,
      mode: message.mode,
      forwardTabId: activeTabId,
    })
    forwardToActiveTab({
      type: 'TRACKING_RESULT',
      rawPoint: payload,
      confidence: message.confidence,
      mode: message.mode,
    })
    return true
  }

  if (message.type === 'CAMERA_PERMISSION_REQUIRED') {
    debugLog('background', 'camera permission required -> opening permission tab')
    chrome.tabs.create({ url: 'src/offscreen/permission.html' })
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'CAMERA_GRANTED') {
    debugLog('background', 'camera granted')
    void startTracking()
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'OFFSCREEN_READY') {
    debugLog('background', 'offscreen ready')
    if (trackingEnabled) {
      sendToOffscreen({ type: 'OFFSCREEN_SET_MODE', mode: currentMode })
      sendToOffscreen({ type: 'OFFSCREEN_START' })
    }
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'STATUS_UPDATE') {
    forwardToAllTabs({ type: 'STATUS_UPDATE', ...message })
    chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', ...message }, () => void chrome.runtime.lastError)
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'TOGGLE_TRACKING') {
    setTrackingEnabled(!!message.enabled)
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'SET_MODE') {
    if (message.mode) {
      currentMode = message.mode
      sendToOffscreen({ type: 'OFFSCREEN_SET_MODE', mode: message.mode })
    }
    forwardToAllTabs(message)
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'CONFIG_UPDATE') {
    if (message.config?.mode) {
      currentMode = message.config.mode
      sendToOffscreen({ type: 'OFFSCREEN_SET_MODE', mode: message.config.mode })
    }
    forwardToAllTabs(message)
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'START_CALIBRATION') {
    if (message.mode) {
      currentMode = message.mode
      sendToOffscreen({ type: 'OFFSCREEN_SET_MODE', mode: message.mode })
    }
    forwardToAllTabs(message)
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'CLEAR_CALIBRATION' || message.type === 'RECENTER') {
    forwardToAllTabs(message)
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'CMD_NEXT_TAB' || message.type === 'CMD_PREV_TAB') {
    switchTab(message.type === 'CMD_NEXT_TAB' ? 1 : -1)
    sendResponse({ success: true })
    return true
  }

  return false
})

export {}
