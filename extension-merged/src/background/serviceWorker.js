import { debugLog, debugEvery } from '../shared/debug.js'
import { createVoiceRouter } from './voiceRouter.js'

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

// Shown in the tabs drop-down when no open tabs can be queried.
const FALLBACK_TABS = [
  { title: 'Google', url: 'https://www.google.com' },
  { title: 'YouTube', url: 'https://www.youtube.com' },
  { title: 'GitHub', url: 'https://github.com' },
  { title: 'Wikipedia', url: 'https://www.wikipedia.org' },
]

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

function openNewTab() {
  chrome.tabs.create({ active: true }, () => void chrome.runtime.lastError)
}

function closeActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0]
    if (tab?.id != null) chrome.tabs.remove(tab.id, () => void chrome.runtime.lastError)
  })
}

function openUrl(url) {
  if (!url) return
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0]
    if (tab?.id != null) {
      chrome.tabs.update(tab.id, { url }, () => void chrome.runtime.lastError)
    } else {
      chrome.tabs.create({ url, active: true }, () => void chrome.runtime.lastError)
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
      reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
      justification: 'Microphone capture and text-to-speech playback for voice control, plus webcam-based head and hand tracking for accessible browsing',
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

// ---------------------------------------------------------------------------
// Voice engine (offscreen mic/STT/TTS + service-worker command routing)
// ---------------------------------------------------------------------------

let voiceListening = false
let voiceAlwaysListening = false
let voiceEngineState = 'stopped'
let voiceMessage = ''
let voiceStartTimer = null
let voiceTtsPaused = false
let ttsSeq = 0
const pendingTts = new Map()

function broadcastVoiceState() {
  const snapshot = voiceRouter.getSnapshot()
  chrome.runtime.sendMessage(
    { type: 'VOICE_STATE', listening: voiceListening, always: voiceAlwaysListening, engineState: voiceEngineState, message: voiceMessage, ...snapshot },
    () => void chrome.runtime.lastError
  )
}

function speak(text) {
  return new Promise((resolve) => {
    const id = ++ttsSeq
    pendingTts.set(id, resolve)
    void ensureOffscreen().then(() => sendToOffscreen({ type: 'VOICE_TTS', text, id }))
  })
}

function stopSpeak() {
  pendingTts.forEach((resolve) => resolve())
  pendingTts.clear()
  sendToOffscreen({ type: 'VOICE_TTS_STOP' })
  voiceTtsPaused = false
  return Promise.resolve()
}

function pauseSpeak() {
  voiceTtsPaused = true
  sendToOffscreen({ type: 'VOICE_TTS_PAUSE' })
  return Promise.resolve()
}

function resumeSpeak() {
  voiceTtsPaused = false
  sendToOffscreen({ type: 'VOICE_TTS_RESUME' })
  return Promise.resolve()
}

const voiceRouter = createVoiceRouter({
  speak,
  stopSpeak,
  pauseSpeak,
  resumeSpeak,
  switchTab,
  openNewTab,
  closeActiveTab,
  openUrl,
  broadcast: (message) => {
    chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError)
  },
})

async function startVoiceListening() {
  if (voiceListening) return
  voiceListening = true
  voiceEngineState = 'starting'
  voiceMessage = ''
  broadcastVoiceState()
  if (voiceStartTimer) clearTimeout(voiceStartTimer)
  voiceStartTimer = setTimeout(() => {
    voiceStartTimer = null
    if (voiceListening && voiceEngineState === 'starting') {
      voiceListening = false
      voiceEngineState = 'error'
      voiceMessage = 'Microphone did not start. Check permissions and try again.'
      broadcastVoiceState()
    }
  }, 8000)
  try {
    await ensureOffscreen()
    sendToOffscreen({ type: 'VOICE_ENGINE_START' })
  } catch (error) {
    voiceListening = false
    voiceEngineState = 'error'
    voiceMessage = 'Voice engine failed to start.'
    if (voiceStartTimer) {
      clearTimeout(voiceStartTimer)
      voiceStartTimer = null
    }
    broadcastVoiceState()
    debugLog('background', 'voice start failed', String(error))
  }
}

function stopVoiceListening() {
  if (!voiceListening) return
  voiceListening = false
  voiceEngineState = 'stopped'
  voiceMessage = ''
  if (voiceStartTimer) {
    clearTimeout(voiceStartTimer)
    voiceStartTimer = null
  }
  void stopSpeak()
  sendToOffscreen({ type: 'VOICE_ENGINE_STOP' })
  broadcastVoiceState()
  void maybeCloseOffscreen()
}

async function setVoiceAlways(enabled) {
  voiceAlwaysListening = enabled
  try {
    await chrome.storage.local.set({ handsfree_voice_always: enabled })
  } catch {
    // ignore persistence failures
  }
  if (enabled) {
    void startVoiceListening()
  } else {
    stopVoiceListening()
  }
  broadcastVoiceState()
}

async function loadVoiceSettings() {
  try {
    const result = await chrome.storage.local.get('handsfree_voice_always')
    voiceAlwaysListening = Boolean(result && result.handsfree_voice_always)
  } catch {
    // keep default
  }
  if (voiceAlwaysListening) void startVoiceListening()
}

async function maybeCloseOffscreen() {
  if (trackingEnabled) return
  if (voiceListening || voiceAlwaysListening) return
  await closeOffscreen()
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
  await maybeCloseOffscreen()
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
void loadVoiceSettings()

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
  if (voicePermissionTabId === tabId) voicePermissionTabId = null
})

chrome.runtime.onStartup.addListener(() => {
  void loadVoiceSettings()
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
  chrome.tabs.create({ url: chrome.runtime.getURL('src/offscreen/permission.html') }, (tab) => {
    if (tab?.id) permissionTabId = tab.id
    setTimeout(() => {
      isOpeningPermissionTab = false
    }, 2000)
  })
}

let voicePermissionTabId = null
let isOpeningVoicePermissionTab = false

function openVoicePermissionTabSingle() {
  if (isOpeningVoicePermissionTab) return
  if (voicePermissionTabId !== null) {
    chrome.tabs.get(voicePermissionTabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        voicePermissionTabId = null
        createVoicePermissionTab()
      } else {
        chrome.tabs.update(voicePermissionTabId, { active: true })
      }
    })
  } else {
    createVoicePermissionTab()
  }
}

function createVoicePermissionTab() {
  isOpeningVoicePermissionTab = true
  chrome.tabs.create({ url: chrome.runtime.getURL('voice/permission.html') }, (tab) => {
    if (tab?.id) voicePermissionTabId = tab.id
    setTimeout(() => {
      isOpeningVoicePermissionTab = false
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

  if (message.type === 'VOICE_CLICK' || message.action === 'VOICE_CLICK') {
    debugLog('background', 'voice click received -> forwarding to active tab', message)
    forwardToActiveTab({
      type: 'VOICE_CLICK',
      action: 'VOICE_CLICK',
      transcript: message.transcript,
    })
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'START_FIELD_DICTATION') {
    debugLog('background', 'auto starting field dictation')
    voiceRouter.setMode('dictation')
    if (!voiceListening) {
      void startVoiceListening()
    }
    sendResponse({ success: true, mode: 'dictation' })
    return true
  }

  if (message.type === 'STOP_FIELD_DICTATION') {
    debugLog('background', 'stopping field dictation -> return to command mode')
    voiceRouter.setMode('command')
    sendResponse({ success: true, mode: 'command' })
    return true
  }

  if (message.type === 'CAMERA_PERMISSION_REQUIRED' || message.type === 'MIC_PERMISSION_REQUIRED') {
    debugLog('background', 'permission required -> opening permission tab')
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
    if (voiceListening || voiceAlwaysListening) {
      sendToOffscreen({ type: 'VOICE_ENGINE_START' })
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

  if (message.type === 'PAGE_NAV') {
    const tabId = sender?.tab?.id ?? activeTabId
    if (tabId != null) {
      if (message.action === 'refresh') {
        chrome.tabs.reload(tabId, () => void chrome.runtime.lastError)
      } else if (message.action === 'back') {
        chrome.tabs.goBack(tabId, () => void chrome.runtime.lastError)
      } else if (message.action === 'forward') {
        chrome.tabs.goForward(tabId, () => void chrome.runtime.lastError)
      }
    }
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'GET_RECENT_TABS') {
    chrome.tabs.query({}, (tabs) => {
      const list = (tabs || [])
        .filter((tab) => tab.id != null)
        .map((tab) => ({
          id: tab.id,
          title: tab.title || tab.url || 'Untitled',
          url: tab.url || '',
          active: Boolean(tab.active),
          windowId: tab.windowId,
          lastAccessed: tab.lastAccessed || 0,
        }))
        .sort((a, b) => {
          if (a.active !== b.active) return a.active ? -1 : 1
          return b.lastAccessed - a.lastAccessed
        })
        .slice(0, 10)
      sendResponse({ tabs: list.length ? list : FALLBACK_TABS })
    })
    return true
  }

  if (message.type === 'ACTIVATE_TAB') {
    if (message.tabId != null) {
      chrome.tabs.update(message.tabId, { active: true }, (tab) => {
        if (chrome.runtime.lastError) return
        if (tab?.windowId != null) chrome.windows.update(tab.windowId, { focused: true })
      })
    } else if (message.url) {
      chrome.tabs.create({ url: message.url, active: true })
    }
    sendResponse({ success: true })
    return true
  }

  // -------------------------------------------------------------------------
  // Voice engine messages
  // -------------------------------------------------------------------------

  // Incoming from the offscreen document.
  if (message.type === 'VOICE_TRANSCRIPT') {
    if (voiceListening) void voiceRouter.handleTranscript(message.transcript)
    return true
  }

  if (message.type === 'VOICE_TTS_DONE') {
    const resolve = pendingTts.get(message.id)
    if (resolve) {
      pendingTts.delete(message.id)
      resolve()
    }
    voiceTtsPaused = false
    return true
  }

  if (message.type === 'VOICE_ENGINE_STATUS') {
    voiceEngineState = message.state || 'stopped'
    if (message.state === 'listening') {
      voiceListening = true
      voiceMessage = 'Listening — speak a command.'
      if (voiceStartTimer) {
        clearTimeout(voiceStartTimer)
        voiceStartTimer = null
      }
    } else if (message.state === 'stopped' || message.state === 'error') {
      voiceListening = false
      if (voiceStartTimer) {
        clearTimeout(voiceStartTimer)
        voiceStartTimer = null
      }
      if (message.state === 'error') voiceMessage = 'Microphone error.'
      else voiceMessage = ''
    }
    broadcastVoiceState()
    return true
  }

  if (message.type === 'VOICE_ENGINE_ERROR') {
    voiceEngineState = 'error'
    voiceListening = false
    if (voiceStartTimer) {
      clearTimeout(voiceStartTimer)
      voiceStartTimer = null
    }
    const name = String(message.name || '').toLowerCase()
    debugLog('background', 'voice engine error', message.name || message.message)
    if (name.includes('notallowed') || name.includes('permission') || name.includes('denied')) {
      voiceMessage = 'Microphone permission needed — click "Fix Mic Permission".'
    } else if (name.includes('notfound')) {
      voiceMessage = 'No microphone found.'
    } else {
      voiceMessage = 'Microphone error — check permissions.'
    }
    broadcastVoiceState()
    if (name.includes('notallowed') || name.includes('permission') || name.includes('denied')) {
      openVoicePermissionTabSingle()
    }
    return true
  }

  // Incoming from the popup.
  if (message.type === 'VOICE_START_LISTENING') {
    void startVoiceListening()
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'VOICE_STOP_LISTENING') {
    stopVoiceListening()
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'VOICE_SET_ALWAYS') {
    void setVoiceAlways(!!message.always)
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'GET_VOICE_STATE') {
    sendResponse({
      listening: voiceListening,
      always: voiceAlwaysListening,
      engineState: voiceEngineState,
      ...voiceRouter.getSnapshot(),
    })
    return true
  }

  if (message.type === 'VOICE_MODE_SET') {
    if (message.mode) {
      voiceRouter.setMode(message.mode)
      if (message.mode !== 'reading' && voiceRouter.isReadingActive()) {
        void voiceRouter.stopReadingPage()
      }
    }
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'VOICE_READ_START') {
    void voiceRouter.startReadingPage()
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'VOICE_READ_NEXT') {
    void voiceRouter.readNextSection()
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'VOICE_READ_PREV') {
    void voiceRouter.readPreviousSection()
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'VOICE_READ_REPEAT') {
    void voiceRouter.repeatCurrentSection()
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'VOICE_READ_STOP') {
    void voiceRouter.stopReadingPage()
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'VOICE_READ_PAUSE_RESUME') {
    void voiceRouter.pauseOrResumeReading()
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'VOICE_SYNC_NUMBERS') {
    voiceRouter.syncNumbersStatus().then((res) => sendResponse(res || { success: false }))
    return true
  }

  if (message.type === 'VOICE_COMMAND') {
    if (message.action === 'BACKSPACE_WORD') {
      void voiceRouter.sendToActiveTab({ action: 'BACKSPACE_WORD' })
    } else if (message.action === 'CLEAR_TEXT') {
      void voiceRouter.sendToActiveTab({ action: 'CLEAR_TEXT' })
    } else if (message.text) {
      void voiceRouter.handleTranscript(message.text)
    }
    sendResponse({ success: true })
    return true
  }

  return false
})
