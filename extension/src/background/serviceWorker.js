import { debugLog, debugEvery } from '../shared/debug.js'
import { isSupportedPage, getBrowserAPI } from '../shared/browserUtils.js'

// Browser API reference (chrome or browser)
const api = getBrowserAPI() || chrome

// Tabs that currently have the content script loaded.
const activeTabs = new Map()

let activeTabId = null
let trackingEnabled = true
let currentMode = 'face'
let offscreenCreating = null

// Multi-browser tracker hosting state:
// 'offscreen' (Chromium) | 'iframe' (Firefox background DOM) | 'tab' (Service worker fallback)
let trackerHostType = null
let trackerTabId = null
let trackerIframe = null

debugLog('background', 'service worker loaded in cross-browser mode')

function isUserTab(tabId) {
  if (tabId == null) return false
  if (trackerTabId !== null && tabId === trackerTabId) return false
  if (permissionTabId !== null && tabId === permissionTabId) return false
  return true
}

function registerTab(tabId, url) {
  if (isUserTab(tabId) && isSupportedPage(url)) {
    activeTabs.set(tabId, { url, lastSeen: Date.now() })
  }
}

function unregisterTab(tabId) {
  activeTabs.delete(tabId)
}

function getActiveTabs() {
  const now = Date.now()
  const tabs = []
  activeTabs.forEach((info, tabId) => {
    if (now - info.lastSeen > 5 * 60 * 1000) {
      activeTabs.delete(tabId)
    } else {
      tabs.push(tabId)
    }
  })
  return tabs
}

function forwardToAllTabs(message) {
  getActiveTabs().forEach((tabId) => {
    api.tabs.sendMessage(tabId, message, () => void api.runtime.lastError)
  })
}

function forwardToActiveTab(message) {
  let tabId = activeTabId
  if (tabId == null || !activeTabs.has(tabId) || !isUserTab(tabId)) {
    api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs.find((t) => t.id && isUserTab(t.id) && isSupportedPage(t.url))
      if (tab?.id) {
        api.tabs.sendMessage(tab.id, message, () => void api.runtime.lastError)
      }
    })
    return
  }
  api.tabs.sendMessage(tabId, message, () => void api.runtime.lastError)
}

function switchTab(direction) {
  api.tabs.query({ currentWindow: true }, (tabs) => {
    if (!tabs.length) return
    const userTabs = tabs.filter((t) => isUserTab(t.id) && isSupportedPage(t.url))
    if (!userTabs.length) return
    const sorted = userTabs.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    const activePos = sorted.findIndex((t) => t.active)
    let nextPos = activePos < 0 ? 0 : activePos + direction
    if (nextPos >= sorted.length) nextPos = 0
    if (nextPos < 0) nextPos = sorted.length - 1
    const next = sorted[nextPos]
    if (next?.id) {
      activeTabId = next.id
      api.tabs.update(next.id, { active: true })
      debugLog('background', 'switchTab', { direction, tabId: next.id })
    }
  })
}

// ---------------------------------------------------------------------------
// Cross-Browser Tracker Host Management
// Supports:
// 1. Chromium offscreen document (Chrome, Edge, Brave, Opera)
// 2. Firefox background page iframe (Firefox with background scripts/DOM)
// 3. Pinned background tab fallback (any browser without DOM or offscreen API)
// ---------------------------------------------------------------------------

async function hasOffscreenDocument() {
  try {
    const runtime = api.runtime
    if (typeof runtime.getContexts === 'function') {
      const contexts = await runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
      return Array.isArray(contexts) && contexts.length > 0
    }
  } catch {
    // getContexts unavailable on some browsers; fall through.
  }
  return false
}

async function isTrackerRunning() {
  if (trackerHostType === 'offscreen') {
    return await hasOffscreenDocument()
  }
  if (trackerHostType === 'iframe') {
    return Boolean(trackerIframe && typeof document !== 'undefined' && document.contains(trackerIframe))
  }
  if (trackerHostType === 'tab') {
    if (trackerTabId == null) return false
    try {
      const tab = await api.tabs.get(trackerTabId)
      return Boolean(tab?.id)
    } catch {
      trackerTabId = null
      return false
    }
  }
  return false
}

async function ensureTrackerHost() {
  if (await isTrackerRunning()) return
  if (offscreenCreating) {
    await offscreenCreating
    return
  }

  const trackerUrl = api.runtime.getURL('src/offscreen/offscreen.html')

  // Strategy 1: Chromium Offscreen Document API (Chrome, Edge, Brave, Opera, Vivaldi)
  if (typeof api.offscreen !== 'undefined' && typeof api.offscreen.createDocument === 'function') {
    trackerHostType = 'offscreen'
    debugLog('background', 'creating Chromium offscreen document')
    offscreenCreating = api.offscreen
      .createDocument({
        url: trackerUrl,
        reasons: ['USER_MEDIA'],
        justification: 'Webcam-based head and hand tracking for accessible browsing',
      })
      .catch((error) => {
        const message = String(error?.message || error)
        if (!message.includes('single offscreen')) {
          console.warn('[Handsfree] Note creating offscreen document:', message)
        }
      })
      .finally(() => {
        offscreenCreating = null
      })
    await offscreenCreating
    return
  }

  // Strategy 2: Firefox Background DOM Iframe (runs in Firefox extension background page)
  if (typeof document !== 'undefined') {
    trackerHostType = 'iframe'
    debugLog('background', 'creating background iframe tracker for Firefox/DOM host')
    if (!trackerIframe || !document.contains(trackerIframe)) {
      trackerIframe = document.createElement('iframe')
      trackerIframe.id = 'handsfree-offscreen-tracker'
      trackerIframe.src = trackerUrl
      trackerIframe.allow = 'camera; microphone'
      // Position offscreen so requestAnimationFrame continues running at full FPS
      trackerIframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;border:none;'
      const mount = document.body || document.documentElement
      if (mount) {
        mount.appendChild(trackerIframe)
      } else {
        window.addEventListener('DOMContentLoaded', () => {
          ;(document.body || document.documentElement)?.appendChild(trackerIframe)
        })
      }
    }
    return
  }

  // Strategy 3: Pinned background tab fallback
  trackerHostType = 'tab'
  debugLog('background', 'creating pinned background tracker tab fallback')
  try {
    const tab = await api.tabs.create({
      url: trackerUrl,
      active: false,
      pinned: true,
    })
    if (tab?.id) {
      trackerTabId = tab.id
    }
  } catch (err) {
    console.warn('[Handsfree] Note creating background tracker tab:', err?.message || err)
  }
}

async function closeTrackerHost() {
  debugLog('background', 'closing tracker host', { trackerHostType })
  if (trackerHostType === 'offscreen' && api.offscreen?.closeDocument) {
    try {
      await api.offscreen.closeDocument()
    } catch {}
  } else if (trackerHostType === 'iframe' && trackerIframe) {
    try {
      trackerIframe.remove()
    } catch {}
    trackerIframe = null
  } else if (trackerHostType === 'tab' && trackerTabId != null) {
    try {
      await api.tabs.remove(trackerTabId)
    } catch {}
    trackerTabId = null
  }
  trackerHostType = null
}

function sendToOffscreen(message) {
  api.runtime.sendMessage({ ...message, target: 'offscreen' }, () => void api.runtime.lastError)
}

async function loadStoredMode() {
  try {
    const storage = api.storage?.sync || api.storage?.local
    if (storage) {
      const result = await storage.get('handsfree_config')
      const mode = result?.handsfree_config?.mode
      if (mode === 'face' || mode === 'hand') return mode
    }
  } catch {
    // Fall through to default.
  }
  return 'face'
}

async function startTracking() {
  currentMode = await loadStoredMode()
  debugLog('background', 'startTracking', { mode: currentMode })
  await ensureTrackerHost()
  sendToOffscreen({ type: 'OFFSCREEN_SET_MODE', mode: currentMode })
  sendToOffscreen({ type: 'OFFSCREEN_START' })
}

async function stopTracking() {
  sendToOffscreen({ type: 'OFFSCREEN_STOP' })
  await closeTrackerHost()
}

function setTrackingEnabled(enabled) {
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

api.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    const storage = api.storage?.sync || api.storage?.local
    if (storage) {
      storage.set({
        handsfree_config: {
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
      })
    }
  }
})

api.tabs.onActivated.addListener((info) => {
  if (isUserTab(info.tabId)) {
    activeTabId = info.tabId
  }
})

api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && isUserTab(tabId)) {
    registerTab(tabId, tab.url)
  }
})

api.tabs.onRemoved.addListener((tabId) => {
  unregisterTab(tabId)
  if (activeTabId === tabId) activeTabId = null
  if (permissionTabId === tabId) permissionTabId = null
  if (trackerTabId === tabId) trackerTabId = null
})

api.commands?.onCommand?.addListener((command) => {
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

let permissionTabId = null
let isOpeningPermissionTab = false

function openPermissionTabSingle() {
  if (isOpeningPermissionTab) return
  if (permissionTabId !== null) {
    api.tabs.get(permissionTabId, (tab) => {
      if (api.runtime.lastError || !tab) {
        permissionTabId = null
        createPermissionTab()
      } else {
        api.tabs.update(permissionTabId, { active: true })
      }
    })
  } else {
    createPermissionTab()
  }
}

function createPermissionTab() {
  isOpeningPermissionTab = true
  const permUrl = api.runtime.getURL('src/offscreen/permission.html')
  api.tabs.create({ url: permUrl }, (tab) => {
    if (tab?.id) permissionTabId = tab.id
    setTimeout(() => {
      isOpeningPermissionTab = false
    }, 2000)
  })
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_VERSION') {
    sendResponse({ version: api.runtime.getManifest().version })
    return true
  }

  if (message.type === 'GET_STATUS') {
    sendResponse({ enabled: trackingEnabled, mode: currentMode })
    return true
  }

  if (message.type === 'OPEN_OPTIONS') {
    if (typeof api.runtime.openOptionsPage === 'function') {
      api.runtime.openOptionsPage()
    }
    return true
  }

  if (message.type === 'TAB_REGISTER') {
    if (sender.tab?.id && sender.tab.url) {
      registerTab(sender.tab.id, sender.tab.url)
      activeTabId = sender.tab.id
      debugLog('background', 'TAB_REGISTER', { tabId: sender.tab.id, url: sender.tab.url })
    }
    sendResponse({ success: true })
    if (trackingEnabled && permissionTabId === null) {
      void startTracking()
    }
    return true
  }

  // Tracking results originate from the offscreen/tracker document.
  if (message.type === 'TRACKING_RESULT') {
    const payload = message.rawPoint
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
    openPermissionTabSingle()
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'CAMERA_GRANTED') {
    debugLog('background', 'camera granted')
    permissionTabId = null
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
    api.runtime.sendMessage({ type: 'STATUS_UPDATE', ...message }, () => void api.runtime.lastError)
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
