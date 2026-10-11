/**
 * Handsfree - Offscreen Background Speech Recognizer
 * Continuously listens for voice commands (e.g. "click", "tap", "press", "select")
 * in the background while tracking is active, so the user can dwell on a link
 * and say "click" without having to keep the popup open.
 */

export class SpeechRecognizer {
  constructor(onCommand) {
    this.onCommand = onCommand
    this.recognition = null
    this.isListening = false
    this.shouldListen = false
    this.lastClickTimestamp = 0
    this.restartTimer = null
  }

  init() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRec) {
      console.warn('[OffscreenSpeech] SpeechRecognition API not supported in offscreen window.')
      return false
    }

    try {
      this.recognition = new SpeechRec()
      this.recognition.continuous = true
      this.recognition.interimResults = true
      this.recognition.lang = 'en-US'
      this.recognition.maxAlternatives = 3

      this.recognition.onstart = () => {
        this.isListening = true
        console.log('[OffscreenSpeech] Continuous voice listening is ACTIVE.')
      }

      this.recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i]
          for (let j = 0; j < res.length; j++) {
            const transcript = res[j].transcript || ''
            this.evaluateTranscript(transcript)
          }
        }
      }

      this.recognition.onerror = (event) => {
        const err = event.error
        // Ignore normal silence/abort timeouts
        if (err === 'no-speech' || err === 'aborted') {
          return
        }
        console.warn('[OffscreenSpeech] Error:', err)
        if (err === 'not-allowed') {
          chrome.runtime.sendMessage({ type: 'MIC_PERMISSION_REQUIRED' }, () => void chrome.runtime.lastError)
        }
      }

      this.recognition.onend = () => {
        this.isListening = false
        if (this.shouldListen) {
          clearTimeout(this.restartTimer)
          this.restartTimer = setTimeout(() => {
            if (this.shouldListen && !this.isListening) {
              try {
                this.recognition.start()
              } catch (_) {}
            }
          }, 250)
        }
      }

      return true
    } catch (e) {
      console.error('[OffscreenSpeech] Initialization error:', e)
      return false
    }
  }

  evaluateTranscript(rawText) {
    if (!rawText) return
    const text = rawText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!text) return

    console.log(`[OffscreenSpeech] Heard: "${text}"`)

    if (this.isClickCommand(text)) {
      const now = Date.now()
      // 800ms debounce to prevent multiple triggers from interim + final
      if (now - this.lastClickTimestamp < 800) return
      this.lastClickTimestamp = now

      console.log(`[OffscreenSpeech] 🎯 Click command confirmed: "${text}"`)
      this.onCommand?.({
        type: 'VOICE_CLICK',
        action: 'VOICE_CLICK',
        transcript: text,
      })
    }
  }

  isClickCommand(text) {
    const words = text.split(/\s+/).filter(Boolean)

    // Direct single word triggers
    const triggers = ['click', 'clic', 'clik', 'tap', 'press', 'select', 'open', 'enter']
    if (words.some((w) => triggers.includes(w))) {
      return true
    }

    // Common spoken phrases
    if (
      text.includes('click') ||
      text.includes('clic') ||
      text.includes('tap') ||
      text.includes('press') ||
      text.includes('click it') ||
      text.includes('click this') ||
      text.includes('click that') ||
      text.includes('click link') ||
      text.includes('click button') ||
      text.includes('open this') ||
      text.includes('open link')
    ) {
      return true
    }

    return false
  }

  start() {
    this.shouldListen = true
    if (!this.recognition) {
      this.init()
    }
    if (this.recognition && !this.isListening) {
      try {
        this.recognition.start()
      } catch (_) {}
    }
  }

  stop() {
    this.shouldListen = false
    clearTimeout(this.restartTimer)
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop()
      } catch (_) {}
    }
  }
}
