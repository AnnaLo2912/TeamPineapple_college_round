import { debugLog, debugEvery } from '../shared/debug.js'

function isSupportedPage(url) {
  if (!url) return false
  return !url.startsWith('chrome://') &&
         !url.startsWith('edge://') &&
         !url.startsWith('about:') &&
         !url.startsWith('chrome-extension://') &&
         !url.startsWith('moz-extension://')
}

// Tabs that currently have the content script loaded.
const activeTabs = new Map()

let activeTabId = null
let trackingEnabled = true
let currentMode = 'face'
let offscreenCreating = null

// Which subsystems are enabled. `voice` is persisted for future use; the
// voice on/off toggle is deferred, so it currently only gates the UI state.
const moduleState = { voice: true, headhands: true }

async function loadModuleState() {
  try {
    const result = await chrome.storage.local.get('handsfree_module_state')
    const saved = result && result.handsfree_module_state
    if (saved) {
      if (typeof saved.voice === 'boolean') moduleState.voice = saved.voice
      if (typeof saved.headhands === 'boolean') {
        moduleState.headhands = saved.headhands
        trackingEnabled = saved.headhands
      }
    }
  } catch {
    // keep defaults
  }
}

async function persistModuleState() {
  try {
    await chrome.storage.local.set({ handsfree_module_state: { ...moduleState } })
  } catch {
    // ignore persistence failures
  }
}

debugLog('background', 'service worker loaded')

function registerTab(tabId, url) {
  if (isSupportedPage(url)) {
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
    chrome.tabs.sendMessage(tabId, message, () => void chrome.runtime.lastError)
  })
}

function forwardToActiveTab(message) {
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

function switchTab(direction) {
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

async function hasOffscreenDocument() {
  try {
    const runtime = chrome.runtime
    if (typeof runtime.getContexts === 'function') {
      const contexts = await runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
      return Array.isArray(contexts) && contexts.length > 0
    }
  } catch {
    // getContexts unavailable on older Chrome; fall through.
  }
  return false
}

async function ensureOffscreen() {
  if (await hasOffscreenDocument()) return
  if (offscreenCreating) {
    await offscreenCreating
    return
  }

  const offscreen = chrome.offscreen

  debugLog('background', 'creating offscreen document')
  offscreenCreating = offscreen
    .createDocument({
      url: 'src/offscreen/offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Webcam-based head and hand tracking for accessible browsing',
    })
    .catch((error) => {
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

async function closeOffscreen() {
  try {
    const offscreen = chrome.offscreen
    await offscreen.closeDocument()
  } catch {
    // Nothing to close.
  }
}

function sendToOffscreen(message) {
  chrome.runtime.sendMessage({ ...message, target: 'offscreen' }, () => void chrome.runtime.lastError)
}

async function loadStoredMode() {
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

function setTrackingEnabled(enabled) {
  trackingEnabled = enabled
  moduleState.headhands = enabled
  if (enabled) {
    void startTracking()
  } else {
    void stopTracking()
  }
  forwardToAllTabs({ type: 'TOGGLE_TRACKING', enabled, timestamp: Date.now() })
}

void loadModuleState()

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set({
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
    chrome.storage.local.get('handsfree_module_state', (r) => {
      if (!r || !r.handsfree_module_state) {
        chrome.storage.local.set({ handsfree_module_state: { voice: true, headhands: true } })
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
  if (permissionTabId === tabId) permissionTabId = null
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

let permissionTabId = null
let isOpeningPermissionTab = false

function openPermissionTabSingle() {
  if (isOpeningPermissionTab) return
  if (permissionTabId !== null) {
    chrome.tabs.get(permissionTabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        permissionTabId = null
        createPermissionTab()
      } else {
        chrome.tabs.update(permissionTabId, { active: true })
      }
    })
  } else {
    createPermissionTab()
  }
}

function createPermissionTab() {
  isOpeningPermissionTab = true
  chrome.tabs.create({ url: 'src/offscreen/permission.html' }, (tab) => {
    if (tab?.id) permissionTabId = tab.id
    setTimeout(() => {
      isOpeningPermissionTab = false
    }, 2000)
  })
}

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
      chrome.tabs.sendMessage(
        sender.tab.id,
        { type: 'MODULE_STATE', voice: moduleState.voice, headhands: trackingEnabled },
        () => void chrome.runtime.lastError
      )
    }
    sendResponse({ success: true })
    if (trackingEnabled && permissionTabId === null) {
      void startTracking()
    }
    return true
  }

  // Tracking results originate from the offscreen document.
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

  if (message.type === 'GET_MODULE_STATE') {
    sendResponse({ voice: moduleState.voice, headhands: trackingEnabled })
    return true
  }

  if (message.type === 'SET_MODULE_STATE') {
    if (typeof message.voice === 'boolean') moduleState.voice = message.voice
    if (typeof message.headhands === 'boolean') {
      moduleState.headhands = message.headhands
      setTrackingEnabled(message.headhands)
    }
    void persistModuleState()
    forwardToAllTabs({ type: 'MODULE_STATE', voice: moduleState.voice, headhands: moduleState.headhands })
    chrome.runtime.sendMessage({ type: 'MODULE_STATE', voice: moduleState.voice, headhands: moduleState.headhands }, () => void chrome.runtime.lastError)
    sendResponse({ success: true, state: { voice: moduleState.voice, headhands: trackingEnabled } })
    return true
  }

  return false
})
