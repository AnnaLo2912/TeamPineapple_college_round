import { debugLog } from '../shared/debug.js'

// Persistent voice engine for the offscreen document. It owns microphone
// capture, VAD-driven chunking, Sarvam STT, and TTS playback. Results are sent
// to the service worker, which performs all tab actions and command routing.

const BACKEND_PORTS = [5001, 5000]
const SILENCE_THRESHOLD_MS = 1600
const MAX_RECORDING_DURATION_MS = 10000
const INITIAL_NO_SPEECH_TIMEOUT_MS = 10000
const VOLUME_THRESHOLD = 16
const VAD_POLL_MS = 100

let backendBaseUrl = null

async function resolveBackendUrl() {
  if (backendBaseUrl) return backendBaseUrl
  for (const port of BACKEND_PORTS) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`, { method: 'GET' })
      if (res.ok) {
        const data = await res.json()
        if (data && data.status === 'ok') {
          backendBaseUrl = `http://localhost:${port}`
          return backendBaseUrl
        }
      }
    } catch {
      // try next port
    }
  }
  backendBaseUrl = `http://localhost:${BACKEND_PORTS[0]}`
  return backendBaseUrl
}

function send(message) {
  try {
    chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError)
  } catch {
    // Background may be briefly unavailable.
  }
}

let active = false
let stream = null
let recorder = null
let chunks = []
let recording = false
let discardCurrent = false
let restartTimer = null

let audioContext = null
let vadSource = null
let vadAnalyser = null
let vadInterval = null
let vadFallbackTimer = null
let hasSpeechStarted = false
let lastSpeechTime = 0
let speechStartTime = 0

let keepAliveAudio = null
let keepAliveUrl = null

let ttsSpeaking = false
let ttsSource = null
let ttsAudio = null
let currentTtsId = null
let ttsPaused = false

function getAudioContext() {
  try {
    if (!audioContext || audioContext.state === 'closed') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (AudioCtx) audioContext = new AudioCtx()
    }
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {})
    }
    return audioContext
  } catch {
    return null
  }
}

// A looping silent <audio> element keeps the offscreen document alive when it
// was created with the AUDIO_PLAYBACK reason (Chrome closes such documents
// after 30s without audio playing). It also keeps the renderer "active" enough
// that the VAD interval is not intensively throttled.
function createSilentWavUrl() {
  try {
    const sampleRate = 8000
    const numSamples = sampleRate
    const buffer = new ArrayBuffer(44 + numSamples * 2)
    const view = new DataView(buffer)
    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i))
    }
    writeString(0, 'RIFF')
    view.setUint32(4, 36 + numSamples * 2, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeString(36, 'data')
    view.setUint32(40, numSamples * 2, true)
    const blob = new Blob([buffer], { type: 'audio/wav' })
    return URL.createObjectURL(blob)
  } catch {
    return null
  }
}

function startKeepAlive() {
  if (keepAliveAudio) return
  try {
    if (!keepAliveUrl) keepAliveUrl = createSilentWavUrl()
    if (!keepAliveUrl) return
    const audio = new Audio(keepAliveUrl)
    audio.loop = true
    audio.volume = 0.01
    audio.play().catch(() => {})
    keepAliveAudio = audio
    debugLog('voice', 'silent keep-alive started')
  } catch {
    // ignore
  }
}

function getSupportedMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/wav',
  ]
  for (const type of types) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type
    } catch {
      // ignore
    }
  }
  return ''
}

async function ensureStream() {
  if (stream && stream.active) return stream
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  return stream
}

function onMicError(error) {
  debugLog('voice', 'mic error', error?.name || String(error))
  send({ type: 'VOICE_ENGINE_ERROR', kind: 'mic', name: error?.name || '', message: error?.message || '' })
}

// --- VAD -------------------------------------------------------------------

function scheduleFallbackStop() {
  if (vadFallbackTimer) clearTimeout(vadFallbackTimer)
  vadFallbackTimer = setTimeout(() => {
    vadFallbackTimer = null
    if (recording) finishRecording()
  }, MAX_RECORDING_DURATION_MS)
}

function startVad(media) {
  cleanupVad()
  const ctx = getAudioContext()
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})

  if (!ctx) {
    scheduleFallbackStop()
    return
  }
  try {
    vadSource = ctx.createMediaStreamSource(media)
    vadAnalyser = ctx.createAnalyser()
    vadAnalyser.fftSize = 512
    vadSource.connect(vadAnalyser)
  } catch (e) {
    debugLog('voice', 'vad setup failed', String(e))
    vadSource = null
    vadAnalyser = null
  }

  if (!vadAnalyser) {
    scheduleFallbackStop()
    return
  }

  const bufferLength = vadAnalyser.frequencyBinCount
  const dataArray = new Uint8Array(bufferLength)
  hasSpeechStarted = false
  speechStartTime = Date.now()
  lastSpeechTime = Date.now()

  // Offscreen documents are hidden, so requestAnimationFrame is paused there.
  // A plain interval keeps the VAD running (same approach as WebcamManager).
  const monitor = () => {
    if (!recording || !vadAnalyser) return
    vadAnalyser.getByteFrequencyData(dataArray)
    let sum = 0
    for (let i = 0; i < bufferLength; i++) sum += dataArray[i]
    const avgVolume = sum / bufferLength
    const now = Date.now()

    if (avgVolume > VOLUME_THRESHOLD) {
      hasSpeechStarted = true
      lastSpeechTime = now
    }

    if (hasSpeechStarted) {
      if (now - lastSpeechTime > SILENCE_THRESHOLD_MS) {
        finishRecording()
        return
      }
    } else if (now - speechStartTime > INITIAL_NO_SPEECH_TIMEOUT_MS) {
      finishRecording()
      return
    }

    if (now - speechStartTime > MAX_RECORDING_DURATION_MS) {
      finishRecording()
    }
  }

  vadInterval = setInterval(monitor, VAD_POLL_MS)
  // Safety net: guarantee a chunk is produced even if the analyser reads zeros
  // (suspended AudioContext) or the interval gets throttled.
  scheduleFallbackStop()
}

function cleanupVad() {
  if (vadInterval) {
    clearInterval(vadInterval)
    vadInterval = null
  }
  if (vadFallbackTimer) {
    clearTimeout(vadFallbackTimer)
    vadFallbackTimer = null
  }
  try {
    vadSource?.disconnect()
  } catch {
    // ignore
  }
  vadSource = null
  vadAnalyser = null
}

// --- Recording loop --------------------------------------------------------

function beginRecording() {
  if (!active || recording || ttsSpeaking) return
  if (!stream || !stream.active) {
    ensureStream().then(beginRecording).catch(onMicError)
    return
  }

  chunks = []
  discardCurrent = false
  try {
    const mimeType = getSupportedMimeType()
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {})
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data)
    }
    recorder.onstop = onRecorderStop
    recorder.onerror = () => {
      recording = false
      cleanupVad()
      recorder = null
      maybeResume()
    }
    recorder.start(100)
    recording = true
    startVad(stream)
  } catch (e) {
    debugLog('voice', 'beginRecording failed', String(e))
    recorder = null
    recording = false
    maybeResume()
  }
}

function finishRecording() {
  if (recorder && recorder.state !== 'inactive') {
    try {
      recorder.stop()
    } catch {
      recording = false
      cleanupVad()
      maybeResume()
    }
  } else {
    recording = false
    cleanupVad()
    maybeResume()
  }
}

function onRecorderStop() {
  cleanupVad()
  recording = false
  const discarded = discardCurrent
  discardCurrent = false
  const mimeType = (recorder && recorder.mimeType) || 'audio/webm'
  recorder = null

  if (discarded) {
    maybeResume()
    return
  }

  const blob = new Blob(chunks, { type: mimeType })
  chunks = []
  if (blob.size === 0) {
    maybeResume()
    return
  }
  void transcribe(blob, mimeType)
}

function maybeResume() {
  if (!active || ttsSpeaking) return
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    beginRecording()
  }, 400)
}

async function transcribe(blob, mimeType) {
  try {
    const base = await resolveBackendUrl()
    const form = new FormData()
    form.append('file', blob, mimeType.includes('mp4') ? 'audio.mp4' : 'audio.webm')
    form.append('model', 'saaras:v3')

    const res = await fetch(`${base}/api/transcribe`, { method: 'POST', body: form })
    const data = await res.json()
    if (res.ok && data.success && data.transcript && data.transcript.trim()) {
      send({ type: 'VOICE_TRANSCRIPT', transcript: data.transcript.trim() })
    }
  } catch (e) {
    debugLog('voice', 'transcribe failed', String(e))
  } finally {
    maybeResume()
  }
}

// --- Lifecycle -------------------------------------------------------------

async function start() {
  if (active) return
  active = true
  debugLog('voice', 'engine start')
  startKeepAlive()
  try {
    const ctx = getAudioContext()
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
    if (ctx) debugLog('voice', 'audio context state', ctx.state)
    await ensureStream()
    beginRecording()
    send({ type: 'VOICE_ENGINE_STATUS', state: 'listening' })
  } catch (e) {
    active = false
    send({ type: 'VOICE_ENGINE_STATUS', state: 'error' })
    onMicError(e)
  }
}

function stop() {
  active = false
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  stopTts()
  if (recorder && recorder.state !== 'inactive') {
    discardCurrent = true
    try {
      recorder.stop()
    } catch {
      // ignore
    }
  }
  recording = false
  cleanupVad()
  if (stream) {
    stream.getTracks().forEach((track) => {
      try {
        track.stop()
      } catch {
        // ignore
      }
    })
    stream = null
  }
  send({ type: 'VOICE_ENGINE_STATUS', state: 'stopped' })
  debugLog('voice', 'engine stop')
}

// --- TTS -------------------------------------------------------------------

function stopTtsSource() {
  if (ttsSource) {
    try {
      ttsSource.stop()
    } catch {
      // ignore
    }
    ttsSource = null
  }
}

function stopTts() {
  stopTtsSource()
  if (ttsAudio) {
    try {
      ttsAudio.pause()
    } catch {
      // ignore
    }
    ttsAudio = null
  }
  try {
    window.speechSynthesis?.cancel()
  } catch {
    // ignore
  }
  if (ttsSpeaking) {
    ttsSpeaking = false
    const id = currentTtsId
    currentTtsId = null
    send({ type: 'VOICE_TTS_DONE', id })
    maybeResume()
  }
}

function finishTts() {
  ttsSpeaking = false
  const id = currentTtsId
  currentTtsId = null
  send({ type: 'VOICE_TTS_DONE', id })
  maybeResume()
}

function playBase64(base64) {
  return new Promise((resolve, reject) => {
    try {
      const ctx = getAudioContext()
      if (!ctx) return reject(new Error('AudioContext unavailable'))
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

      ctx.decodeAudioData(
        bytes.buffer.slice(0),
        (audioBuffer) => {
          try {
            stopTtsSource()
            const source = ctx.createBufferSource()
            source.buffer = audioBuffer
            source.connect(ctx.destination)
            ttsSource = source
            source.onended = () => {
              if (ttsSource === source) ttsSource = null
              resolve()
            }
            if (ctx.state === 'suspended') ctx.resume().catch(() => {})
            source.start(0)
          } catch (e) {
            reject(e)
          }
        },
        (err) => reject(err || new Error('decode failed'))
      )
    } catch (e) {
      reject(e)
    }
  })
}

function speakWithSynth(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve()
    try {
      window.speechSynthesis.cancel()
    } catch {
      // ignore
    }
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1.0
    utterance.pitch = 1.0
    utterance.onend = () => resolve()
    utterance.onerror = () => resolve()
    window.speechSynthesis.speak(utterance)
  })
}

async function speak(text, id) {
  if (!text || !text.trim()) {
    send({ type: 'VOICE_TTS_DONE', id })
    return
  }

  currentTtsId = id ?? null
  ttsSpeaking = true
  ttsPaused = false

  // Pause capture while speaking to avoid the mic hearing the TTS output.
  if (recorder && recorder.state !== 'inactive') {
    discardCurrent = true
    try {
      recorder.stop()
    } catch {
      // ignore
    }
  }
  recording = false
  cleanupVad()
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }

  try {
    const base = await resolveBackendUrl()
    const res = await fetch(`${base}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, speaker: 'simran_en_narration', model: 'bulbul:v4-flash' }),
    })
    const data = await res.json()
    if (res.ok && data.success && data.audio_base64) {
      await playBase64(data.audio_base64)
      finishTts()
      return
    }
    throw new Error(data.error || `TTS status ${res.status}`)
  } catch (e) {
    debugLog('voice', 'sarvam tts failed, using browser voice', String(e))
  }

  try {
    await speakWithSynth(text)
  } catch (e) {
    debugLog('voice', 'browser tts failed', String(e))
  }
  finishTts()
}

function pauseTts() {
  ttsPaused = true
  if (audioContext && audioContext.state === 'running') {
    audioContext.suspend().catch(() => {})
  } else if (window.speechSynthesis && window.speechSynthesis.speaking) {
    try {
      window.speechSynthesis.pause()
    } catch {
      // ignore
    }
  }
}

function resumeTts() {
  ttsPaused = false
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {})
  } else if (window.speechSynthesis && window.speechSynthesis.paused) {
    try {
      window.speechSynthesis.resume()
    } catch {
      // ignore
    }
  }
}

// --- Message handling ------------------------------------------------------

const voiceMessageHandler = (message) => {
  if (!message || message.target !== 'offscreen') return
  switch (message.type) {
    case 'VOICE_ENGINE_START':
      void start()
      break
    case 'VOICE_ENGINE_STOP':
      stop()
      break
    case 'VOICE_TTS':
      void speak(message.text, message.id)
      break
    case 'VOICE_TTS_STOP':
      stopTts()
      break
    case 'VOICE_TTS_PAUSE':
      pauseTts()
      break
    case 'VOICE_TTS_RESUME':
      resumeTts()
      break
  }
}

export function initVoiceEngine() {
  chrome.runtime.onMessage.addListener(voiceMessageHandler)
  startKeepAlive()
  debugLog('voice', 'engine module loaded')
}
