// Voice command router (service worker side).
//
// The offscreen document performs microphone capture, Sarvam STT, and TTS, but
// offscreen documents can only use the `runtime` API. All tab actions,
// command parsing, and reading state therefore live here in the service worker.

const Mode = {
  COMMAND: 'command',
  DICTATION: 'dictation',
  READING: 'reading',
  BLIND: 'blind',
}

const WORDS_TO_NUM = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
}

const WORD_DIGITS = {
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
}

// Token-based spelled-number normalisation ("go to four" -> "go to 4"). Whole
// tokens are mapped so words like "seventeen" are not split into "7teen".
function normalizeSpokenNumbers(input) {
  if (!input) return ''
  return input
    .split(/\s+/)
    .map((token) => {
      const bare = token.replace(/[^\w]/g, '')
      if (bare && WORDS_TO_NUM[bare] !== undefined) return token.replace(bare, String(WORDS_TO_NUM[bare]))
      return token
    })
    .join(' ')
}

// Common spoken site names -> canonical URLs for the "open <site>" command.
const SITE_ALIASES = {
  youtube: 'https://www.youtube.com',
  google: 'https://www.google.com',
  gmail: 'https://mail.google.com',
  'google mail': 'https://mail.google.com',
  github: 'https://github.com',
  wikipedia: 'https://www.wikipedia.org',
  maps: 'https://maps.google.com',
  'google maps': 'https://maps.google.com',
  twitter: 'https://twitter.com',
  x: 'https://x.com',
  facebook: 'https://www.facebook.com',
  instagram: 'https://www.instagram.com',
  linkedin: 'https://www.linkedin.com',
  reddit: 'https://www.reddit.com',
  amazon: 'https://www.amazon.com',
  netflix: 'https://www.netflix.com',
  spotify: 'https://open.spotify.com',
  whatsapp: 'https://web.whatsapp.com',
  'whats app': 'https://web.whatsapp.com',
  chatgpt: 'https://chatgpt.com',
  'chat gpt': 'https://chatgpt.com',
  stackoverflow: 'https://stackoverflow.com',
  'stack overflow': 'https://stackoverflow.com',
  drive: 'https://drive.google.com',
  'google drive': 'https://drive.google.com',
  calendar: 'https://calendar.google.com',
  'google calendar': 'https://calendar.google.com',
  translate: 'https://translate.google.com',
  'google translate': 'https://translate.google.com',
  news: 'https://news.google.com',
  'google news': 'https://news.google.com',
}

// Resolve a spoken site name to a URL: a known alias, a literal domain, or a
// Google search fallback.
function resolveWebsiteUrl(target) {
  const clean = (target || '').trim().toLowerCase().replace(/[^a-z0-9 .-]/g, '')
  if (!clean) return null
  if (SITE_ALIASES[clean]) return SITE_ALIASES[clean]
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(clean)) return `https://${clean}`
  return `https://www.google.com/search?q=${encodeURIComponent(clean)}`
}

// Gmail compose pop-out (view=cm) — opens a fresh draft window.
const EMAIL_COMPOSE_URL = 'https://mail.google.com/mail/?view=cm&fs=1&tf=1'

// Spoken phrases that switch operating mode. Keys are normalised (lowercase,
// punctuation stripped, whitespace collapsed) so they match `executeVoiceCommand`.
const MODE_COMMANDS = {
  command: ['command', 'command mode', 'stop dictation'],
  dictation: ['dictation', 'dictation mode', 'start dictation'],
  reading: ['reading', 'reading mode', 'read mode'],
  blind: ['blind mode', 'eyes free', 'eyes free mode', 'enable blind mode', 'start blind mode'],
  'disable-blind': ['disable blind mode', 'stop blind mode', 'exit blind mode', 'turn off blind mode'],
}

function matchModeCommand(text) {
  if (!text) return null
  for (const [mode, phrases] of Object.entries(MODE_COMMANDS)) {
    if (phrases.includes(text)) return mode
  }
  return null
}

function isRestrictedUrl(url) {
  const u = url || ''
  return (
    u.startsWith('chrome://') ||
    u.startsWith('chrome-extension://') ||
    u.startsWith('chrome-search://') ||
    u.startsWith('edge://') ||
    u.startsWith('about:') ||
    u.includes('chrome.google.com/webstore') ||
    u.includes('chromewebstore.google.com')
  )
}

export function createVoiceRouter(deps) {
  const { speak, stopSpeak, pauseSpeak, resumeSpeak, broadcast, switchTab, openNewTab, closeActiveTab, openUrl, openUrlNewTab, recenter } = deps

  let activeMode = Mode.COMMAND
  let isReadingActive = false
  let readingSections = []
  let currentReadingIndex = -1
  let numbersActive = false
  let ttsPaused = false
  let lastTranscript = ''
  let lastMessage = ''

  function snapshot() {
    return {
      mode: activeMode,
      readingActive: isReadingActive,
      readingIndex: currentReadingIndex,
      readingTotal: readingSections.length,
      numbersActive,
      transcript: lastTranscript,
      message: lastMessage,
    }
  }

  function emit() {
    broadcast({ type: 'VOICE_STATE', ...snapshot() })
  }

  function setMessage(message) {
    lastMessage = message
    emit()
  }

  async function getActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs && tabs[0] ? tabs[0] : null)
      })
    })
  }

  async function sendToActiveTab(message) {
    try {
      const tab = await getActiveTab()
      if (!tab || !tab.id) return { success: false, error: 'No active tab found.' }
      if (isRestrictedUrl(tab.url)) {
        return { success: false, error: 'Handsfree is not supported on Chrome system or Webstore pages.' }
      }

      try {
        const response = await chrome.tabs.sendMessage(tab.id, message)
        if (response !== undefined) return response
      } catch {
        // Content script may not be loaded yet; inject below.
      }

      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['voice/content.js'] })
        await new Promise((r) => setTimeout(r, 100))
        const retry = await chrome.tabs.sendMessage(tab.id, message)
        return retry || { success: true }
      } catch {
        return { success: false, error: 'Cannot access page content on this tab.' }
      }
    } catch (err) {
      return { success: false, error: err?.message || 'Tab messaging error.' }
    }
  }

  function setMode(mode) {
    activeMode = mode
    emit()
  }

  function setNumbersActive(value) {
    numbersActive = value
    emit()
  }

  function extractSpokenNumber(text, isExplicitClickOnly = false) {
    if (!text) return null
    const clean = normalizeSpokenNumbers(text.toLowerCase().replace(/[^\w\s#]/g, '').trim())

    if (isExplicitClickOnly) {
      const explicit = clean.match(/^(?:click|open|press|go\s*to)\s+(?:link\s+|number\s+|#)?(\d{1,3})\b/i)
      if (explicit && explicit[1]) return parseInt(explicit[1], 10)
      return null
    }

    const prefix = clean.match(/^(?:click|open|press|select|go\s*to|number|link)\s+#?(\d{1,3})\b/i)
    if (prefix && prefix[1]) return parseInt(prefix[1], 10)

    if (numbersActive) {
      const standalone = clean.match(/^#?(\d{1,3})$/)
      if (standalone && standalone[1]) {
        const n = parseInt(standalone[1], 10)
        if (n >= 1 && n <= 300) return n
      }
      for (const [word, n] of Object.entries(WORDS_TO_NUM)) {
        const pattern = new RegExp(`^(?:click|open|link)?\\s*\\b${word}\\b$`, 'i')
        if (pattern.test(clean)) return n
      }
    }

    return null
  }

  function isBlindCommand(lower) {
    const blindCommands = [
      'go to search', 'cursor go to search', 'search bar', 'focus search', 'search input', 'find search',
      'done', 'finished', 'query done', 'done typing', 'search done',
      'search', 'execute search', 'submit search', 'google search', 'run search',
      'read links', 'read results', 'read top links', 'read search results', 'read result links',
      'show numbered links', 'hide numbered links',
      'refresh numbered links', 'refresh links', 'refresh numbers', 'update numbered links',
      'blind mode', 'eyes free', 'eyes free mode', 'enable blind mode', 'start blind mode',
      'disable blind mode', 'stop blind mode', 'exit blind mode', 'turn off blind mode',
      'scroll down', 'scroll up', 'page down', 'page up',
      'stop', 'stop reading', 'cancel',
      'clear text', 'clear input', 'clear',
      'backspace', 'delete word', 'back space',
      'next tab', 'previous tab', 'prev tab', 'last tab', 'switch tab',
      'new tab', 'open new tab', 'close tab', 'close this tab', 'close current tab',
      'recalibrate', 'recenter', 'recenter cursor', 'recenter the cursor',
      'draft an email', 'draft email', 'compose email', 'compose an email', 'write an email', 'new email',
    ]
    if (blindCommands.includes(lower)) return true
    if (matchModeCommand(lower)) return true
    const normalized = normalizeSpokenNumbers(lower)
    if (/^(?:click|open|select|press|go\s*to)\s+(?:link\s+|result\s+|number\s+|#)?\d{1,3}$/i.test(normalized)) return true
    if (/^(?:link|result|number)\s+#?\d{1,3}$/i.test(normalized)) return true
    if (
      /^(?:open|go\s*to|navigate\s*to|visit)\s+(?!(?:new\s+tab|tab|link|number|result|search)\b)[a-z0-9][a-z0-9 .-]*$/i.test(normalized)
    )
      return true
    return false
  }

  async function updateBlindMode(enabled) {
    if (enabled) {
      setMode(Mode.BLIND)
    } else if (activeMode === Mode.BLIND) {
      setMode(Mode.COMMAND)
    }
    try {
      await chrome.storage.local.set({ blindModeEnabled: enabled })
    } catch {
      // ignore persistence failures
    }
    await sendToActiveTab({ action: 'SET_BLIND_MODE', enabled })
    emit()
  }

  // --- Reader --------------------------------------------------------------

  async function startReadingPage() {
    await stopSpeak()
    setMode(Mode.READING)
    isReadingActive = true
    currentReadingIndex = 0
    setMessage('Extracting webpage content for reading...')

    const response = await sendToActiveTab({ action: 'GET_READABLE_SECTIONS' })
    if (!response || !response.success || !response.sections || response.sections.length === 0) {
      setMessage(response?.error || 'Could not find readable content on active page.')
      isReadingActive = false
      emit()
      return
    }

    readingSections = response.sections
    setMessage(`Reading started (${readingSections.length} sections found).`)
    await readCurrentSection()
  }

  async function readCurrentSection() {
    if (!isReadingActive || currentReadingIndex < 0 || currentReadingIndex >= readingSections.length) {
      await stopReadingPage()
      return
    }

    const section = readingSections[currentReadingIndex]
    setMessage(`Section ${currentReadingIndex + 1}/${readingSections.length}`)
    await sendToActiveTab({ action: 'HIGHLIGHT_SECTION', index: currentReadingIndex })
    await speak(section.text)
    if (!isReadingActive) return
    setMessage(`Section ${currentReadingIndex + 1} read. Say "next" to advance.`)
  }

  async function readNextSection() {
    if (readingSections.length === 0) {
      await startReadingPage()
      return
    }
    if (currentReadingIndex < readingSections.length - 1) {
      currentReadingIndex++
      await readCurrentSection()
    }
  }

  async function readPreviousSection() {
    if (currentReadingIndex > 0) {
      currentReadingIndex--
      await readCurrentSection()
    }
  }

  async function repeatCurrentSection() {
    if (currentReadingIndex >= 0 && currentReadingIndex < readingSections.length) {
      await readCurrentSection()
    }
  }

  async function pauseOrResumeReading() {
    if (!ttsPaused) {
      await pauseSpeak()
      ttsPaused = true
      setMessage('Paused')
    } else {
      await resumeSpeak()
      ttsPaused = false
      setMessage('Reading...')
    }
  }

  async function stopReadingPage() {
    isReadingActive = false
    currentReadingIndex = -1
    ttsPaused = false
    await stopSpeak()
    await sendToActiveTab({ action: 'CLEAR_HIGHLIGHT' })
    setMessage('Stopped')
  }

  // --- Command parser ------------------------------------------------------

  async function executeVoiceCommand(cmdText) {
    if (!cmdText) return
    let text = cmdText.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim()
    for (const [w, d] of Object.entries(WORD_DIGITS)) {
      text = text.replace(new RegExp(`\\b${w}\\b`, 'g'), d)
    }

    const modeCommand = matchModeCommand(text)
    if (modeCommand === 'blind') {
      setMessage('Command: Enable Eyes-Free Blind Mode')
      await updateBlindMode(true)
      return
    }
    if (modeCommand === 'disable-blind') {
      setMessage('Command: Disable Eyes-Free Blind Mode')
      await updateBlindMode(false)
      return
    }
    if (modeCommand === 'command') {
      setMessage('Command: Command Mode')
      if (isReadingActive) await stopReadingPage()
      setMode(Mode.COMMAND)
      setMessage('Switched to Command Mode.')
      return
    }
    if (modeCommand === 'dictation') {
      setMessage('Command: Dictation Mode')
      if (isReadingActive) await stopReadingPage()
      setMode(Mode.DICTATION)
      setMessage('Switched to Dictation Mode.')
      return
    }
    if (modeCommand === 'reading') {
      setMessage('Command: Reading Mode')
      setMode(Mode.READING)
      setMessage('Switched to Reading Mode.')
      return
    }

    if (text === 'go to search' || text === 'cursor go to search' || text === 'search bar' || text === 'focus search' || text === 'search input' || text === 'find search') {
      setMessage('Command: Go to search')
      const res = await sendToActiveTab({ action: 'GO_TO_SEARCH' })
      setMessage(res && res.success ? (res.message || 'Search input focused.') : (res?.error || 'Could not find search bar on page.'))
      return
    }

    if (text === 'done' || text === 'finished' || text === 'query done' || text === 'done typing' || text === 'search done') {
      setMessage('Command: Query finished')
      const res = await sendToActiveTab({ action: 'FINISH_QUERY' })
      setMessage(res && res.success ? `Query ready: "${res.query || ''}". Say "Search".` : 'Query finished. Say "Search" to execute.')
      return
    }

    if (text === 'search' || text === 'execute search' || text === 'submit search' || text === 'run search' || text === 'google search') {
      setMessage('Command: Execute search')
      const res = await sendToActiveTab({ action: 'EXECUTE_SEARCH' })
      setMessage(res && res.success ? 'Search submitted.' : (res?.error || 'Could not submit search.'))
      return
    }

    if (text === 'read links' || text === 'read results' || text === 'read top links' || text === 'read search results' || text === 'read result links') {
      setMessage('Command: Read search results')
      const res = await sendToActiveTab({ action: 'READ_SEARCH_RESULTS' })
      setMessage(res && res.success ? `Reading ${res.count || 0} results. Say "Click link 1" to open.` : (res?.error || 'No search results found to read.'))
      return
    }

    const searchResultMatch = text.match(/^(?:click|open)\s+(?:link\s+|result\s+)?(\d{1,2})$/) || text.match(/^(?:link|result)\s+(\d{1,2})$/)
    if (searchResultMatch && searchResultMatch[1]) {
      const resultIndex = parseInt(searchResultMatch[1], 10)
      setMessage(`Command: Open result #${resultIndex}`)
      const res = await sendToActiveTab({ action: 'CLICK_SEARCH_RESULT', number: resultIndex })
      if (res && res.success) {
        setMessage(`Opening result #${resultIndex}: "${res.title}"`)
      } else {
        const numRes = await sendToActiveTab({ action: 'CLICK_NUMBERED_LINK', number: resultIndex })
        setNumbersActive(true)
        setMessage(numRes && numRes.success ? `Clicked #${resultIndex}: "${numRes.label}"` : (res?.error || numRes?.error || `Link #${resultIndex} not found.`))
      }
      return
    }

    if (text === 'show numbers' || text === 'show links' || text === 'show badges' || text === 'numbers' || text === 'show numbered links') {
      setMessage('Command: Show numbered links')
      const res = await sendToActiveTab({ action: 'SHOW_NUMBERED_LINKS' })
      setNumbersActive(true)
      setMessage(`Showing ${res?.count || 0} numbered links.`)
      return
    }
    if (text === 'hide numbers' || text === 'hide links' || text === 'hide badges' || text === 'hide numbered links') {
      setMessage('Command: Hide numbered links')
      await sendToActiveTab({ action: 'HIDE_NUMBERED_LINKS' })
      setNumbersActive(false)
      setMessage('Hidden link numbers.')
      return
    }
    if (text === 'refresh numbered links' || text === 'refresh links' || text === 'refresh numbers' || text === 'update numbered links') {
      setMessage('Command: Refresh numbered links')
      const res = await sendToActiveTab({ action: 'SHOW_NUMBERED_LINKS' })
      setNumbersActive(true)
      setMessage(`Showing ${res?.count || 0} numbered links.`)
      return
    }

    if (text === 'next tab' || text === 'switch tab' || text === 'next page tab') {
      setMessage('Command: Next tab')
      if (switchTab) switchTab(1)
      setMessage('Switched to next tab.')
      return
    }
    if (text === 'previous tab' || text === 'prev tab' || text === 'last tab' || text === 'back tab') {
      setMessage('Command: Previous tab')
      if (switchTab) switchTab(-1)
      setMessage('Switched to previous tab.')
      return
    }
    if (text === 'new tab' || text === 'open new tab' || text === 'create tab') {
      setMessage('Command: New tab')
      if (openNewTab) openNewTab()
      setMessage('Opened a new tab.')
      return
    }
    if (text === 'close tab' || text === 'close this tab' || text === 'close current tab') {
      setMessage('Command: Close tab')
      if (closeActiveTab) closeActiveTab()
      setMessage('Closed the tab.')
      return
    }

    if (text === 'recalibrate' || text === 'recenter' || text === 'recenter cursor' || text === 'recenter the cursor') {
      setMessage('Command: Recenter')
      if (recenter) recenter()
      setMessage('Recentering in 1.8s — look forward.')
      return
    }

    if (
      text === 'draft an email' || text === 'draft email' || text === 'compose email' ||
      text === 'compose an email' || text === 'write an email' || text === 'new email'
    ) {
      setMessage('Command: Draft an email')
      if (openUrlNewTab) openUrlNewTab(EMAIL_COMPOSE_URL)
      setMessage('Opening a new email draft...')
      return
    }

    const siteMatch = text.match(/^(?:open|go to|navigate to|visit)\s+(.+)$/)
    if (siteMatch && siteMatch[1]) {
      const target = siteMatch[1].trim()
      const isLookup =
        /^(?:link|number|result|tab|search|it|this|that)\b/.test(target) || /^\d+$/.test(target)
      if (!isLookup) {
        const resolved = resolveWebsiteUrl(target)
        if (resolved) {
          setMessage(`Command: Open ${target}`)
          if (openUrl) openUrl(resolved)
          setMessage(
            resolved.includes('/search?q=')
              ? `Searching for "${target}"...`
              : `Opening ${target}...`
          )
          return
        }
      }
    }

    const targetLinkNum = extractSpokenNumber(text)
    if (targetLinkNum !== null) {
      setMessage(`Command: Click link #${targetLinkNum}`)
      const res = await sendToActiveTab({ action: 'CLICK_NUMBERED_LINK', number: targetLinkNum })
      if (res && res.success) {
        setNumbersActive(true)
        setMessage(`Clicked #${targetLinkNum}: "${res.label}"`)
      } else {
        setMessage(res?.error || `Link #${targetLinkNum} not found.`)
      }
      return
    }

    if (text === 'next' || text === 'read next' || text === 'next section' || text === 'go next') {
      setMessage('Command: Next section')
      await readNextSection()
    } else if (text === 'previous' || text === 'read previous' || text === 'previous section' || text === 'prev') {
      setMessage('Command: Previous section')
      await readPreviousSection()
    } else if (text === 'start reading' || text === 'read page' || text === 'read webpage') {
      setMessage('Command: Start reading page')
      await startReadingPage()
    } else if (text === 'pause' || text === 'pause reading') {
      setMessage('Command: Pause reading')
      await pauseOrResumeReading()
    } else if (text === 'resume' || text === 'resume reading' || text === 'continue reading') {
      setMessage('Command: Resume reading')
      await pauseOrResumeReading()
    } else if (text === 'stop' || text === 'stop reading') {
      setMessage('Command: Stop reading')
      await stopReadingPage()
    } else if (text === 'repeat' || text === 'repeat that' || text === 'repeat section') {
      setMessage('Command: Repeat section')
      await repeatCurrentSection()
    } else if (text === 'scroll down' || text === 'page down') {
      setMessage('Command: Scroll down')
      await sendToActiveTab({ action: 'SCROLL', direction: 'down' })
    } else if (text === 'scroll up' || text === 'page up') {
      setMessage('Command: Scroll up')
      await sendToActiveTab({ action: 'SCROLL', direction: 'up' })
    } else if (text === 'read selected' || text === 'read selection') {
      setMessage('Command: Read selected text')
      const res = await sendToActiveTab({ action: 'GET_SELECTED_TEXT' })
      if (res && res.text) await speak(res.text)
      else setMessage(res?.error || 'No text selected.')
    } else if (text === 'backspace' || text === 'delete word' || text === 'back space') {
      setMessage('Command: Backspace word')
      await sendToActiveTab({ action: 'BACKSPACE_WORD' })
    } else if (text === 'clear text' || text === 'clear input' || text === 'clear') {
      setMessage('Command: Clear text field')
      await sendToActiveTab({ action: 'CLEAR_TEXT' })
    } else if (text === 'undo' || text === 'uncheck' || text === 'deselect' || text === 'clear options') {
      setMessage('Command: Undo / uncheck options')
      await sendToActiveTab({ action: 'UNDO_CHECKED_OPTIONS', sectionIndex: currentReadingIndex })
    } else if (text === 'submit' || text === 'submit form' || text === 'send form') {
      setMessage('Command: Submit form')
      await sendToActiveTab({ action: 'SUBMIT_FORM' })
    } else if (text === 'cancel') {
      await stopReadingPage()
      setMessage('Cancelled.')
    } else {
      setMessage(`Unrecognized command: "${cmdText}".`)
    }
  }

  // --- Transcript routing --------------------------------------------------

  async function handleTranscript(rawTranscript) {
    const transcript = (rawTranscript || '').trim()
    if (!transcript) return

    lastTranscript = transcript
    emit()

    const lower = transcript.toLowerCase().replace(/[^\w\s]/g, '').trim()
    let hasNextTrigger = false
    let dictationPayload = transcript

    if (['next', 'next question', 'read next', 'go next', 'next section'].includes(lower)) {
      hasNextTrigger = true
      dictationPayload = ''
    } else if (/\bnext[.!?]?$/i.test(transcript)) {
      hasNextTrigger = true
      dictationPayload = transcript.replace(/\bnext[.!?]?$/i, '').trim()
    }

    if (activeMode === Mode.COMMAND) {
      await executeVoiceCommand(transcript)
    } else if (activeMode === Mode.BLIND) {
      if (isBlindCommand(lower)) {
        await executeVoiceCommand(transcript)
      } else {
        let trailingAction = null
        let payload = transcript
        if (/\b(?:done|finished)$/i.test(payload)) {
          trailingAction = 'done'
          payload = payload.replace(/\b(?:done|finished)$/i, '').trim()
        } else if (/\b(?:search)$/i.test(payload)) {
          trailingAction = 'search'
          payload = payload.replace(/\b(?:search)$/i, '').trim()
        }
        if (payload.length > 0) {
          await sendToActiveTab({ action: 'INSERT_DICTATION', text: payload })
        }
        if (trailingAction === 'done') await executeVoiceCommand('done')
        else if (trailingAction === 'search') await executeVoiceCommand('search')
      }
    } else if (activeMode === Mode.DICTATION || activeMode === Mode.READING) {
      const isActionCommand =
        [
          'previous', 'prev', 'read previous', 'previous section',
          'repeat', 'repeat that', 'repeat section',
          'scroll down', 'scroll up', 'page down', 'page up',
          'pause', 'pause reading', 'resume', 'resume reading',
          'stop', 'stop reading', 'cancel',
          'backspace', 'back space', 'delete word',
          'clear text', 'clear input', 'clear',
          'undo', 'uncheck', 'deselect', 'clear options',
          'submit', 'submit form', 'send form',
          'show numbers', 'show links', 'show badges', 'numbers', 'show numbered links',
          'hide numbers', 'hide links', 'hide badges', 'hide numbered links',
          'refresh numbered links', 'refresh links', 'refresh numbers', 'update numbered links',
          'go to search', 'cursor go to search', 'search bar', 'focus search',
          'done', 'finished', 'query done', 'search', 'execute search',
          'read links', 'read results', 'read top links',
          'blind mode', 'eyes free', 'enable blind mode', 'disable blind mode',
          'next tab', 'previous tab', 'prev tab', 'last tab', 'switch tab',
          'new tab', 'open new tab', 'close tab', 'close this tab', 'close current tab',
          'recalibrate', 'recenter', 'recenter cursor', 'recenter the cursor',
          'draft an email', 'draft email', 'compose email', 'compose an email', 'write an email', 'new email',
        ].includes(lower) || matchModeCommand(lower) !== null || extractSpokenNumber(transcript, true) !== null

      if (isActionCommand) {
        await executeVoiceCommand(transcript)
        return
      }

      const isOptionSelection =
        /^(select|choose|pick|check)\b/i.test(dictationPayload) || /^(select|choose|pick|check)\b/i.test(lower)

      if (isOptionSelection || (dictationPayload && dictationPayload.length > 0)) {
        const selectRes = await sendToActiveTab({
          action: 'SELECT_OPTION',
          text: dictationPayload,
          sectionIndex: currentReadingIndex,
        })
        if (selectRes && selectRes.success && hasNextTrigger) {
          await readNextSection()
          return
        }
      }

      if (dictationPayload.length > 0) {
        await sendToActiveTab({ action: 'INSERT_DICTATION', text: dictationPayload })
      }

      if (hasNextTrigger) await readNextSection()
    }

    emit()
  }

  async function syncNumbersStatus() {
    const res = await sendToActiveTab({ action: 'GET_NUMBERED_LINKS_STATUS' })
    if (res && res.success) {
      numbersActive = !!res.isVisible
      emit()
    }
    return res
  }

  return {
    handleTranscript,
    setMode,
    getSnapshot: snapshot,
    setNumbersActive,
    syncNumbersStatus,
    startReadingPage,
    stopReadingPage,
    readNextSection,
    readPreviousSection,
    repeatCurrentSection,
    pauseOrResumeReading,
    sendToActiveTab,
    isReadingActive: () => isReadingActive,
    getMode: () => activeMode,
  }
}
