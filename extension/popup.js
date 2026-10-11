/**
 * Handsfree Chrome Extension - Popup Controller
 * Phase 1 & Foundation Setup
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const copyBtn = document.getElementById('copyBtn');

  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const messageBox = document.getElementById('messageBox');
  const messageText = document.getElementById('messageText');

  const transcriptBox = document.getElementById('transcriptBox');
  const transcriptText = document.getElementById('transcriptText');
  const visualizer = document.getElementById('visualizer');
  const backendIndicator = document.getElementById('backendIndicator');
  const grantMicBtn = document.getElementById('grantMicBtn');
  const toggleNumbersBtn = document.getElementById('toggleNumbersBtn');
  const toggleNumbersText = document.getElementById('toggleNumbersText');
  const openBenchmarkBtn = document.getElementById('openBenchmarkBtn');
  const modeBlindBtn = document.getElementById('modeBlind');
  const blindModeToggle = document.getElementById('blindModeToggle');
  const blindModeCard = document.getElementById('blindModeCard');
  const openGoogleBtn = document.getElementById('openGoogleBtn');

  // Backend Express Base URL (supports 5001 as default to prevent macOS AirPlay port 5000 conflicts, with auto-fallback)
  let backendBaseUrl = 'http://localhost:5001';

  async function resolveBackendUrl() {
    for (const port of [5001, 5000]) {
      try {
        const res = await fetch(`http://localhost:${port}/api/health`, { method: 'GET' });
        if (res.ok) {
          const data = await res.json();
          if (data && data.status === 'ok') {
            backendBaseUrl = `http://localhost:${port}`;
            return backendBaseUrl;
          }
        }
      } catch (e) {
        // Fallback to next port
      }
    }
    return backendBaseUrl;
  }

  function getHealthUrl() { return `${backendBaseUrl}/api/health`; }
  function getTranscribeUrl() { return `${backendBaseUrl}/api/transcribe`; }
  function getTtsUrl() { return `${backendBaseUrl}/api/tts`; }

  // Application State
  const State = {
    IDLE: 'idle',
    REQUESTING: 'requesting',
    RECORDING: 'recording',
    TRANSCRIBING: 'transcribing',
    COMPLETED: 'completed',
    ERROR: 'error'
  };

  let currentState = State.IDLE;

  /**
   * Update Extension UI based on state
   * @param {string} state - State from State enum
   * @param {string} [customMessage] - Optional status message
   */
  function setUIState(state, customMessage = '') {
    currentState = state;

    // Reset badge classes
    statusBadge.className = 'status-badge';
    messageBox.className = 'message-box';
    if (grantMicBtn) grantMicBtn.classList.add('hidden');

    switch (state) {
      case State.IDLE:
        statusBadge.classList.add('status-idle');
        statusText.textContent = 'Idle';
        messageBox.classList.add('message-info');
        messageText.textContent = customMessage || 'Click "Start Listening" to activate voice capture.';
        startBtn.disabled = false;
        stopBtn.disabled = true;
        break;

      case State.REQUESTING:
        statusBadge.classList.add('status-idle');
        statusText.textContent = 'Mic Check...';
        messageBox.classList.add('message-info');
        messageText.textContent = customMessage || 'Requesting microphone permission...';
        startBtn.disabled = true;
        stopBtn.disabled = true;
        break;

      case State.RECORDING:
        statusBadge.classList.add('status-recording');
        statusText.textContent = 'Recording';
        messageBox.classList.add('message-recording');
        messageText.textContent = customMessage || 'Listening... Speak clearly into your microphone.';
        visualizer.classList.add('recording');
        startBtn.disabled = true;
        stopBtn.disabled = false;
        break;

      case State.TRANSCRIBING:
        statusBadge.classList.add('status-transcribing');
        statusText.textContent = 'Processing';
        messageBox.classList.add('message-info');
        messageText.textContent = customMessage || 'Sending audio to Sarvam STT engine...';
        startBtn.disabled = true;
        stopBtn.disabled = true;
        break;

      case State.COMPLETED:
        statusBadge.classList.add('status-completed');
        statusText.textContent = 'Completed';
        messageBox.classList.add('message-success');
        messageText.textContent = customMessage || 'Transcription completed successfully!';
        startBtn.disabled = false;
        stopBtn.disabled = true;
        break;

      case State.ERROR:
        statusBadge.classList.add('status-error');
        statusText.textContent = 'Notice';
        messageBox.classList.add('message-error');
        messageText.textContent = customMessage || 'An error occurred. Please try again.';
        const lowerMsg = (customMessage || '').toLowerCase();
        if (grantMicBtn) {
          if (lowerMsg.includes('mic permission') || lowerMsg.includes('permission denied') || lowerMsg.includes('notallowederror')) {
            grantMicBtn.classList.remove('hidden');
          } else {
            grantMicBtn.classList.add('hidden');
          }
        }
        if (openGoogleBtn) {
          if (lowerMsg.includes('system') || lowerMsg.includes('chrome://') || lowerMsg.includes('restricted') || lowerMsg.includes('webstore')) {
            openGoogleBtn.classList.remove('hidden');
          } else {
            openGoogleBtn.classList.add('hidden');
          }
        }
        startBtn.disabled = false;
        stopBtn.disabled = true;
        break;
    }
  }

  /**
   * Check backend express API health
   */
  async function checkBackendHealth() {
    try {
      await resolveBackendUrl();
      const response = await fetch(getHealthUrl(), { method: 'GET' });
      if (response.ok) {
        const data = await response.json();
        if (data && data.status === 'ok') {
          backendIndicator.classList.add('backend-online');
          backendIndicator.classList.remove('backend-offline');
          backendIndicator.title = `Express Backend is online (${backendBaseUrl})`;
          return true;
        }
      }
      throw new Error('Invalid backend response');
    } catch (err) {
      backendIndicator.classList.add('backend-offline');
      backendIndicator.classList.remove('backend-online');
      backendIndicator.title = `Backend offline (${backendBaseUrl})`;
      return false;
    }
  }

  // --- Event Listeners ---

  // Audio Capture Variables
  let mediaStream = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let recordedAudioBlob = null;
  let recordingTimer = null;
  let recordingSeconds = 0;

  // Voice Activity Detection (VAD) / Silence Detection Variables
  let audioContext = null;
  let vadAnalyser = null;
  let vadAnimationFrame = null;
  let speechStartTime = 0;
  let lastSpeechTime = 0;
  let hasSpeechStarted = false;
  const SILENCE_THRESHOLD_MS = 1600; // 1.6s of silence after speech stops
  const MAX_RECORDING_DURATION_MS = 10000; // 10s max chunk duration
  const INITIAL_NO_SPEECH_TIMEOUT_MS = 10000; // 10s timeout if user does not speak

  let pcmProcessor = null;
  let pcmSamples = [];

  function encodeWavBlob(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeString = (v, offset, str) => {
      for (let i = 0; i < str.length; i++) v.setUint8(offset + i, str.charCodeAt(i));
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // Mono PCM
    view.setUint16(22, 1, true); // 1 channel
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  function resampleTo16k(samples, fromRate) {
    if (fromRate === 16000) return samples;
    const ratio = fromRate / 16000;
    const newLen = Math.round(samples.length / ratio);
    const res = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      res[i] = samples[Math.floor(i * ratio)] || 0;
    }
    return res;
  }

  /**
   * Monitor audio volume stream for speech activity and auto-stop recorder on silence
   */
  function startSilenceDetection(stream) {
    cleanupSilenceDetection();
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioContext || audioContext.state === 'closed') {
        audioContext = new AudioCtx();
      } else if (audioContext.state === 'suspended') {
        audioContext.resume();
      }

      const source = audioContext.createMediaStreamSource(stream);
      vadAnalyser = audioContext.createAnalyser();
      vadAnalyser.fftSize = 512;
      source.connect(vadAnalyser);

      // Connect PCM processor for clean 16kHz WAV encoding
      pcmSamples = [];
      try {
        pcmProcessor = audioContext.createScriptProcessor(4096, 1, 1);
        pcmProcessor.onaudioprocess = (e) => {
          if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
          const inputData = e.inputBuffer.getChannelData(0);
          for (let i = 0; i < inputData.length; i++) {
            pcmSamples.push(inputData[i]);
          }
        };
        source.connect(pcmProcessor);
        pcmProcessor.connect(audioContext.destination);
      } catch (procErr) {
        console.warn('[Handsfree PCM] ScriptProcessor init warning:', procErr);
      }

      const bufferLength = vadAnalyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      hasSpeechStarted = false;
      speechStartTime = Date.now();
      lastSpeechTime = Date.now();

      function monitorLevel() {
        if (!mediaRecorder || mediaRecorder.state !== 'recording') return;

        vadAnalyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avgVolume = sum / bufferLength;
        const now = Date.now();

        // Volume threshold for speech detection (prevents background fan/hum false triggers)
        if (avgVolume > 16) {
          if (!hasSpeechStarted) {
            hasSpeechStarted = true;
            console.log('[Handsfree VAD] Speech detected!');
          }
          lastSpeechTime = now;
        }

        // Auto-stop evaluation:
        if (hasSpeechStarted) {
          // 1. Silence after user finished speaking
          if (now - lastSpeechTime > SILENCE_THRESHOLD_MS) {
            console.log('[Handsfree VAD] Silence detected after speech. Auto-stopping recorder.');
            stopRecording();
            return;
          }
        } else {
          // 2. Initial silence timeout (user hasn't spoken yet)
          if (now - speechStartTime > INITIAL_NO_SPEECH_TIMEOUT_MS) {
            console.log('[Handsfree VAD] Initial speech timeout. Auto-stopping recorder.');
            stopRecording();
            return;
          }
        }

        // 3. Max duration cap safeguard
        if (now - speechStartTime > MAX_RECORDING_DURATION_MS) {
          console.log('[Handsfree VAD] Max duration limit reached. Auto-stopping recorder.');
          stopRecording();
          return;
        }

        vadAnimationFrame = requestAnimationFrame(monitorLevel);
      }

      vadAnimationFrame = requestAnimationFrame(monitorLevel);
    } catch (e) {
      console.warn('[Handsfree VAD] AudioAnalyser setup warning:', e);
    }
  }

  function cleanupSilenceDetection() {
    if (vadAnimationFrame) {
      cancelAnimationFrame(vadAnimationFrame);
      vadAnimationFrame = null;
    }
    if (pcmProcessor) {
      try { pcmProcessor.disconnect(); } catch (e) {}
      pcmProcessor = null;
    }
  }

  /**
   * Determine supported audio mime type for recording
   */
  function getSupportedMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
      'audio/wav'
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return ''; // Default browser selection
  }

  /**
   * Clean up microphone stream and stop all audio tracks
   */
  function stopAudioStream() {
    cleanupSilenceDetection();
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
      } catch (e) { }
    }
    mediaRecorder = null;

    if (mediaStream) {
      mediaStream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (e) { }
      });
      mediaStream = null;
    }
  }

  /**
   * Format seconds to MM:SS string
   */
  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  /**
   * Start recording audio from microphone
   */
  async function startRecording() {
    try {
      // Stop any active TTS audio playback & clean up previous hardware tracks
      stopTtsPlayback();
      stopAudioStream();
      clearInterval(recordingTimer);

      setUIState(State.REQUESTING, 'Requesting microphone access...');
      audioChunks = [];
      recordedAudioBlob = null;
      recordingSeconds = 0;

      // Check browser support
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Audio recording (getUserMedia) is not supported in this browser.');
      }

      // Pre-check permission if supported to avoid DOMException error logs in dev mode
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const perm = await navigator.permissions.query({ name: 'microphone' });
          if (perm && perm.state !== 'granted') {
            stopAudioStream();
            clearInterval(recordingTimer);
            setUIState(State.ERROR, 'Mic setup tab opened. Please click "Allow" in that tab, then try again!');
            openPermissionTab();
            return;
          }
        } catch (pErr) {
          // Permissions API query for microphone might throw in some Chrome versions; ignore and proceed to getUserMedia
        }
      }

      // 1. Request microphone access with 5s timeout race safeguard
      const getUserMediaPromise = navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Microphone acquisition timed out. Please click Start Listening again.')), 5000);
      });

      mediaStream = await Promise.race([getUserMediaPromise, timeoutPromise]);

      // 2. Initialize MediaRecorder
      const mimeType = getSupportedMimeType();
      const options = mimeType ? { mimeType } : {};
      mediaRecorder = new MediaRecorder(mediaStream, options);

      // Collect audio chunks
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      // Handle recording stop event
      mediaRecorder.onstop = async (event) => {
        clearInterval(recordingTimer);

        let uploadBlob = null;
        let actualMime = 'audio/webm';
        if (pcmSamples && pcmSamples.length > 0 && audioContext) {
          try {
            const resampled = resampleTo16k(pcmSamples, audioContext.sampleRate || 48000);
            uploadBlob = encodeWavBlob(resampled, 16000);
            actualMime = 'audio/wav';
          } catch (pcmErr) {
            console.warn('[Handsfree WAV] PCM encoding fallback:', pcmErr);
            actualMime = (mediaRecorder && mediaRecorder.mimeType) || (event && event.target && event.target.mimeType) || mimeType || 'audio/webm';
            uploadBlob = new Blob(audioChunks, { type: actualMime });
          }
        } else {
          actualMime = (mediaRecorder && mediaRecorder.mimeType) || (event && event.target && event.target.mimeType) || mimeType || 'audio/webm';
          uploadBlob = new Blob(audioChunks, { type: actualMime });
        }

        recordedAudioBlob = uploadBlob;

        // Stop hardware mic stream
        stopAudioStream();

        const blobSizeKB = (recordedAudioBlob.size / 1024).toFixed(1);
        console.log(`[Handsfree] Audio recording stopped. Blob size: ${blobSizeKB} KB, Type: ${actualMime}`);

        if (recordedAudioBlob.size === 0) {
          setUIState(State.ERROR, 'Recorded audio was empty. Please try again.');
          if (isReadingActive || activeMode === Mode.BLIND) {
            setTimeout(() => {
              if ((isReadingActive || activeMode === Mode.BLIND) && currentState !== State.RECORDING && currentState !== State.REQUESTING && !isTtsSpeaking) {
                startRecording();
              }
            }, 600);
          }
        } else {
          // Trigger backend Sarvam transcription
          await sendAudioForTranscription(recordedAudioBlob, actualMime);
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error('[Handsfree] MediaRecorder error:', event.error);
        stopAudioStream();
        clearInterval(recordingTimer);
        setUIState(State.ERROR, `Recording error: ${event.error?.message || 'Unknown error'}`);
      };

      // 3. Start recording with VAD silence monitoring
      mediaRecorder.start(100); // collect 100ms data chunks
      startSilenceDetection(mediaStream);
      setUIState(State.RECORDING, `Listening... [00:00] Speak clearly.`);

      // Timer update
      recordingTimer = setInterval(() => {
        recordingSeconds++;
        if (currentState === State.RECORDING) {
          messageText.textContent = `Listening... [${formatTime(recordingSeconds)}] Speak clearly into your microphone.`;
        }
      }, 1000);

    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        console.warn('[Handsfree] Microphone permission pending/denied in popup context.');
      } else {
        console.error('[Handsfree] getUserMedia error:', err.name || err, err.message || '');
      }
      stopAudioStream();
      clearInterval(recordingTimer);

      let errorMessage = 'Failed to access microphone.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage = 'Mic setup tab opened. Please click "Allow" in that tab, then try again!';
        openPermissionTab();
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMessage = 'No microphone device found. Please connect a microphone.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMessage = 'Microphone is already in use by another application.';
      } else if (err.message) {
        errorMessage = err.message;
      }

      setUIState(State.ERROR, errorMessage);
    }
  }

  /**
   * Open full permission setup tab
   */
  function openPermissionTab() {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
    } else {
      window.open('permission.html', '_blank');
    }
  }

  /**
   * Stop recording audio
   */
  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    } else {
      stopAudioStream();
      clearInterval(recordingTimer);
      setUIState(State.IDLE, 'Recording stopped.');
    }
  }

  // Application Modes
  const Mode = {
    COMMAND: 'command',
    DICTATION: 'dictation',
    READING: 'reading',
    BLIND: 'blind'
  };

  // State Management
  let activeMode = Mode.COMMAND; // Default mode is COMMAND
  let isProcessingTranscript = false;
  let lastDictatedSearchQuery = '';

  const modeCommandBtn = document.getElementById('modeCommand');
  const modeDictationBtn = document.getElementById('modeDictation');
  const modeReadingBtn = document.getElementById('modeReading');

  /**
   * Check if transcript is an Eyes-Free Blind Navigation command
   */
  function isBackspaceCommand(text) {
    if (!text) return false;
    const clean = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    return /^(?:backspace|back\s*space|delete\s*word|delete\s*last\s*word|delete|delete\s*that|delete\s*text|erase\s*word|erase\s*last\s*word|erase\s*that|erase\s*text|undo\s*word|remove\s*word)(?:\s+(?:command|please|it|that|word))?$/i.test(clean);
  }

  function isClearCommand(text) {
    if (!text) return false;
    const clean = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    return /^(?:clear\s+(?:the\s+)?(?:text|input|field|all|screen|box)|clear\s*all(?:\s*text)?|clear|delete\s*all|erase\s*all(?:\s*text)?|reset\s+(?:text|input|field))(?:\s+(?:command|please|it|that))?$/i.test(clean);
  }

  const TRAILING_BACKSPACE_REGEX = /(?:[\s,]+|^)(?:backspace|back\s*space|delete\s*word|delete\s*last\s*word|delete|erase\s*word|undo\s*word)(?:\s+(?:command|please|it|that|word))?[.!?]*$/i;
  const TRAILING_CLEAR_REGEX = /(?:[\s,]+|^)(?:clear\s+(?:the\s+)?(?:text|input|field|all|box)|clear\s*all(?:\s*text)?|clear|delete\s*all|erase\s*all)(?:\s+(?:command|please|it|that))?[.!?]*$/i;

  function isBlindCommand(lower, transcript) {
    if (isBackspaceCommand(lower) || isClearCommand(lower)) return true;
    const blindCommands = [
      'go to search', 'cursor go to search', 'search bar', 'focus search', 'search input', 'find search',
      'done', 'finished', 'query done', 'done typing', 'search done',
      'search', 'execute search', 'submit search', 'google search', 'run search',
      'read', 'read links', 'read results', 'read top links', 'read search results', 'read result links',
      'read hotels', 'read top hotels', 'read places', 'read restaurants',
      'what are the hotels', 'what are the results', 'tell me the results', 'tell me the hotels', 'repeat results',
      'blind mode', 'eyes free', 'eyes free mode', 'enable blind mode', 'start blind mode',
      'disable blind mode', 'stop blind mode', 'exit blind mode', 'turn off blind mode',
      'scroll down', 'scroll up', 'page down', 'page up',
      'stop', 'stop reading', 'cancel',
      'clear text', 'clear input', 'clear', 'clear field', 'clear all',
      'backspace', 'delete word', 'back space', 'delete'
    ];

    if (blindCommands.includes(lower)) return true;

    // Pattern for click link N, click result N, click hotel N, open N, etc.
    if (/^(?:click|open|select|press|go\s*to)\s+(?:link\s+|result\s+|hotel\s+|place\s+|number\s+|#)?\d{1,3}$/i.test(lower)) return true;
    if (/^(?:link|result|hotel|place|number)\s+#?\d{1,3}$/i.test(lower)) return true;
    if (/^(?:click|open)\s+(?:link\s+|result\s+|hotel\s+|place\s+)?(?:one|two|three|four|five|six|seven|eight|nine|ten)$/i.test(lower)) return true;

    return false;
  }

  /**
   * Switch Active Extension Mode
   */
  function setActiveMode(mode) {
    activeMode = mode;

    [modeCommandBtn, modeDictationBtn, modeReadingBtn, modeBlindBtn].forEach(btn => {
      if (btn) {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
      }
    });

    if (mode === Mode.COMMAND) {
      if (modeCommandBtn) {
        modeCommandBtn.classList.add('active');
        modeCommandBtn.setAttribute('aria-selected', 'true');
      }
      if (currentState === State.IDLE) {
        messageText.textContent = 'Command Mode active. Speak commands like "Next", "Start reading", or "Scroll down".';
      }
    } else if (mode === Mode.DICTATION) {
      if (modeDictationBtn) {
        modeDictationBtn.classList.add('active');
        modeDictationBtn.setAttribute('aria-selected', 'true');
      }
      if (currentState === State.IDLE) {
        messageText.textContent = 'Dictation Mode active. Transcripts will be inserted into focused text fields.';
      }
    } else if (mode === Mode.READING) {
      if (modeReadingBtn) {
        modeReadingBtn.classList.add('active');
        modeReadingBtn.setAttribute('aria-selected', 'true');
      }
      if (currentState === State.IDLE) {
        messageText.textContent = 'Reading Mode active. Conversational form filling & reading active.';
      }
    } else if (mode === Mode.BLIND) {
      if (modeBlindBtn) {
        modeBlindBtn.classList.add('active');
        modeBlindBtn.setAttribute('aria-selected', 'true');
      }
      if (currentState === State.IDLE) {
        messageText.textContent = 'Eyes-Free Blind Mode active. Say "Go to search", "Read links", or "Click link 1".';
      }
    }
  }

  /**
   * Update Eyes-Free Blind Mode state across storage, UI, and active tab
   */
  async function updateBlindModeState(enabled) {
    if (blindModeToggle) {
      blindModeToggle.checked = enabled;
    }

    if (enabled) {
      setActiveMode(Mode.BLIND);
      if (currentState === State.IDLE) {
        ensureAudioContext();
        startRecording();
      }
    } else if (activeMode === Mode.BLIND) {
      setActiveMode(Mode.COMMAND);
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ blindModeEnabled: enabled });
    }

    const res = await sendToActiveTab({ action: 'SET_BLIND_MODE', enabled });
    if (enabled) {
      setUIState(State.COMPLETED, 'Eyes-Free Blind Navigation enabled.');
    } else {
      setUIState(State.COMPLETED, 'Eyes-Free Blind Navigation disabled.');
    }
    return res;
  }

  /**
   * Synchronize Eyes-Free Blind Mode toggle and UI on startup
   */
  function syncBlindModeStatus() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['blindModeEnabled'], (result) => {
        const isEnabled = !!result.blindModeEnabled;
        if (blindModeToggle) {
          blindModeToggle.checked = isEnabled;
        }
        if (isEnabled && activeMode !== Mode.BLIND) {
          setActiveMode(Mode.BLIND);
        }
      });
    }

    sendToActiveTab({ action: 'GET_BLIND_MODE_STATUS' }).then(res => {
      if (res && res.success && typeof res.isBlindMode === 'boolean') {
        if (blindModeToggle) {
          blindModeToggle.checked = res.isBlindMode;
        }
        if (res.isBlindMode && activeMode !== Mode.BLIND) {
          setActiveMode(Mode.BLIND);
        }
      }
    });
  }

  /**
   * Upload audio blob to Express backend and route transcript based on ACTIVE MODE
   */
  async function sendAudioForTranscription(blob, mimeType) {
    if (isProcessingTranscript) return;
    isProcessingTranscript = true;

    const TRANSCRIBE_URL = getTranscribeUrl();
    setUIState(State.TRANSCRIBING, 'Transcribing audio with Sarvam AI...');

    try {
      const formData = new FormData();
      const filename = mimeType.includes('wav') ? 'audio.wav' : (mimeType.includes('mp4') ? 'audio.mp4' : 'audio.webm');
      formData.append('file', blob, filename);
      formData.append('model', 'saaras:v3');

      const response = await fetch(TRANSCRIBE_URL, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || `Transcription failed with status ${response.status}`);
      }

      const rawTranscript = data.transcript || '';
      const transcript = rawTranscript.trim();

      transcriptText.textContent = transcript || '(No speech detected)';
      transcriptText.classList.remove('placeholder-text');

      if (!transcript || transcript === '(No speech detected)') {
        setUIState(State.COMPLETED, 'No speech detected.');
        isProcessingTranscript = false;

        // Auto re-listen if conversational reading or blind mode is active
        if (isReadingActive || activeMode === Mode.BLIND) {
          console.log('[Handsfree] No speech detected. Re-listening...');
          setTimeout(() => {
            if ((isReadingActive || activeMode === Mode.BLIND) && currentState !== State.RECORDING && currentState !== State.REQUESTING && !isTtsSpeaking) {
              startRecording();
            }
          }, 500);
        }
        return;
      }

      // Check for trailing "next" trigger or standalone "next" command
      const lower = transcript.toLowerCase().replace(/[^\w\s]/g, '').trim();
      let hasNextTrigger = false;
      let dictationPayload = transcript;

      if (['next', 'next question', 'read next', 'go next', 'next section'].includes(lower)) {
        hasNextTrigger = true;
        dictationPayload = '';
      } else if (/\bnext[\.\!\?]?$/i.test(transcript)) {
        hasNextTrigger = true;
        dictationPayload = transcript.replace(/\bnext[\.\!\?]?$/i, '').trim();
      }

      // MODE-BASED ROUTING
      if (activeMode === Mode.COMMAND) {
        setUIState(State.COMPLETED, `Command: "${transcript}"`);
        executeVoiceCommand(transcript);
      } else if (activeMode === Mode.BLIND) {
        // Blind Mode Voice Routing
        if (isBackspaceCommand(lower)) {
          setUIState(State.COMPLETED, 'Command: Backspace word');
          sendToActiveTab({ action: 'BACKSPACE_WORD' });
        } else if (isClearCommand(lower)) {
          setUIState(State.COMPLETED, 'Command: Clear text field');
          sendToActiveTab({ action: 'CLEAR_TEXT' });
        } else if (isBlindCommand(lower, transcript)) {
          setUIState(State.COMPLETED, `Blind Command: "${transcript}"`);
          executeVoiceCommand(transcript);
        } else {
          // Check for trailing action ("search" or "done") with punctuation support
          const trimmed = transcript.trim();
          const trailingSearchRegex = /[\s,]+(?:search|google search|execute search|submit search)[\.\!\?,]*$/i;
          const trailingDoneRegex = /[\s,]+(?:done|finished|done typing|query done)[\.\!\?,]*$/i;

          let trailingAction = null;
          let dictationPayload = trimmed;

          if (TRAILING_BACKSPACE_REGEX.test(dictationPayload)) {
            const withoutCmd = dictationPayload.replace(TRAILING_BACKSPACE_REGEX, '').trim();
            if (withoutCmd) {
              await sendToActiveTab({ action: 'INSERT_DICTATION', text: withoutCmd });
            }
            await sendToActiveTab({ action: 'BACKSPACE_WORD' });
            setUIState(State.COMPLETED, 'Command: Backspace word');
            return;
          }
          if (TRAILING_CLEAR_REGEX.test(dictationPayload)) {
            await sendToActiveTab({ action: 'CLEAR_TEXT' });
            setUIState(State.COMPLETED, 'Command: Clear text field');
            return;
          }

          if (trailingSearchRegex.test(trimmed)) {
            trailingAction = 'search';
            dictationPayload = trimmed.replace(trailingSearchRegex, '').replace(/[\s,]+$/, '').trim();
          } else if (trailingDoneRegex.test(trimmed)) {
            trailingAction = 'done';
            dictationPayload = trimmed.replace(trailingDoneRegex, '').replace(/[\s,]+$/, '').trim();
          }

          if (isBackspaceCommand(dictationPayload)) {
            setUIState(State.COMPLETED, 'Command: Backspace word');
            await sendToActiveTab({ action: 'BACKSPACE_WORD' });
            return;
          }
          if (isClearCommand(dictationPayload)) {
            setUIState(State.COMPLETED, 'Command: Clear text field');
            await sendToActiveTab({ action: 'CLEAR_TEXT' });
            return;
          }

          if (dictationPayload.length > 0) {
            lastDictatedSearchQuery = dictationPayload;
            await sendToActiveTab({ action: 'INSERT_DICTATION', text: dictationPayload });
          }

          if (trailingAction === 'done') {
            setUIState(State.COMPLETED, `Query ready: "${dictationPayload || lastDictatedSearchQuery}". Say "Search" to execute.`);
            await sendToActiveTab({ action: 'FINISH_QUERY', query: dictationPayload || lastDictatedSearchQuery });
          } else if (trailingAction === 'search') {
            setUIState(State.COMPLETED, `Searching for "${dictationPayload || lastDictatedSearchQuery}"...`);
            await sendToActiveTab({ action: 'EXECUTE_SEARCH', query: dictationPayload || lastDictatedSearchQuery });
          } else {
            setUIState(State.COMPLETED, `Entered: "${dictationPayload}". (Say "Done" or "Search")`);
          }
        }
      } else if (activeMode === Mode.DICTATION || activeMode === Mode.READING) {
        if (isBackspaceCommand(lower)) {
          setUIState(State.COMPLETED, 'Command: Backspace word');
          sendToActiveTab({ action: 'BACKSPACE_WORD' });
          return;
        }
        if (isClearCommand(lower)) {
          setUIState(State.COMPLETED, 'Command: Clear text field');
          sendToActiveTab({ action: 'CLEAR_TEXT' });
          return;
        }

        // Voice action commands during dictation & reading
        const isActionCommand = [
          'previous', 'prev', 'read previous', 'previous section',
          'repeat', 'repeat that', 'repeat section',
          'scroll down', 'scroll up', 'page down', 'page up',
          'pause', 'pause reading', 'resume', 'resume reading',
          'stop', 'stop reading', 'cancel',
          'undo', 'uncheck', 'deselect', 'clear options',
          'submit', 'submit form', 'send form',
          'show numbers', 'show links', 'show badges', 'numbers',
          'hide numbers', 'hide links', 'hide badges',
          'go to search', 'cursor go to search', 'search bar', 'focus search',
          'done', 'finished', 'query done', 'search', 'execute search',
          'read links', 'read results', 'read top links',
          'blind mode', 'eyes free', 'enable blind mode', 'disable blind mode'
        ].includes(lower) || extractSpokenNumber(transcript, true) !== null;

        if (isActionCommand) {
          executeVoiceCommand(transcript);
          if (isReadingActive && !['stop', 'cancel', 'submit', 'submit form', 'send form'].includes(lower)) {
            setTimeout(() => {
              if (isReadingActive && currentState !== State.RECORDING && currentState !== State.REQUESTING && !isTtsSpeaking) {
                startRecording();
              }
            }, 600);
          }
          return;
        }

        // Trailing backspace or clear in dictation
        if (TRAILING_BACKSPACE_REGEX.test(dictationPayload)) {
          const withoutCmd = dictationPayload.replace(TRAILING_BACKSPACE_REGEX, '').trim();
          if (withoutCmd) {
            await sendToActiveTab({ action: 'INSERT_DICTATION', text: withoutCmd });
          }
          await sendToActiveTab({ action: 'BACKSPACE_WORD' });
          setUIState(State.COMPLETED, 'Command: Backspace word');
          return;
        }
        if (TRAILING_CLEAR_REGEX.test(dictationPayload)) {
          await sendToActiveTab({ action: 'CLEAR_TEXT' });
          setUIState(State.COMPLETED, 'Command: Clear text field');
          return;
        }

        // Try option selection first for radio buttons / checkboxes (e.g. "select record", "select female", "select pizza and burger")
        let isOptionSelection = false;
        if (/^(select|choose|pick|check)\b/i.test(dictationPayload) || /^(select|choose|pick|check)\b/i.test(lower)) {
          isOptionSelection = true;
        }

        if (isOptionSelection || (dictationPayload && dictationPayload.length > 0)) {
          const selectRes = await sendToActiveTab({
            action: 'SELECT_OPTION',
            text: dictationPayload,
            sectionIndex: currentReadingIndex
          });

          if (selectRes && selectRes.success) {
            console.log('[Handsfree Option] Voice option selection succeeded:', selectRes);
            const statusMsg = selectRes.message || `Selected option(s)`;
            setUIState(State.COMPLETED, hasNextTrigger ? `${statusMsg}. Advancing...` : `${statusMsg}. (Say "next" to advance)`);

            if (hasNextTrigger) {
              setTimeout(() => {
                readNextSection();
              }, 300);
              return;
            } else if (isReadingActive) {
              // Re-open microphone to listen for "next" keyword
              setTimeout(() => {
                if (isReadingActive && currentState !== State.RECORDING && currentState !== State.REQUESTING && !isTtsSpeaking) {
                  startRecording();
                }
              }, 600);
              return;
            }
          }
        }

        if (isBackspaceCommand(dictationPayload)) {
          setUIState(State.COMPLETED, 'Command: Backspace word');
          await sendToActiveTab({ action: 'BACKSPACE_WORD' });
          return;
        }
        if (isClearCommand(dictationPayload)) {
          setUIState(State.COMPLETED, 'Command: Clear text field');
          await sendToActiveTab({ action: 'CLEAR_TEXT' });
          return;
        }

        // Fallback: Text field dictation insertion
        if (dictationPayload.length > 0) {
          const insertRes = await sendToActiveTab({ action: 'INSERT_DICTATION', text: dictationPayload });
          if (insertRes && insertRes.success) {
            setUIState(State.COMPLETED, hasNextTrigger ? `Inserted: "${dictationPayload}". Advancing...` : `Inserted: "${dictationPayload}". (Say "next" to advance)`);
          } else {
            setUIState(State.COMPLETED, `Dictated: "${dictationPayload}".`);
          }
        }

        if (hasNextTrigger) {
          console.log('[Handsfree Conversational] "Next" trigger detected! Advancing to next section.');
          setTimeout(() => {
            readNextSection();
          }, 300);
        } else if (isReadingActive) {
          // Continuous loop: re-listen until user says "next"
          setTimeout(() => {
            if (isReadingActive && currentState !== State.RECORDING && currentState !== State.REQUESTING && !isTtsSpeaking) {
              startRecording();
            }
          }, 600);
        }
      }

      // Continuous loop for Eyes-Free Blind Mode
      if (activeMode === Mode.BLIND) {
        const isStopCmd = ['stop', 'cancel', 'stop listening', 'disable blind mode', 'exit blind mode', 'turn off blind mode'].includes(lower);
        if (!isStopCmd) {
          setTimeout(() => {
            if (activeMode === Mode.BLIND && currentState !== State.RECORDING && currentState !== State.REQUESTING && !isTtsSpeaking) {
              startRecording();
            }
          }, 850);
        }
      }

      console.log('[Handsfree] Transcription result:', data);

    } catch (err) {
      console.error('[Handsfree] Transcription fetch error:', err);
      setUIState(State.ERROR, `Transcription error: ${err.message}`);
    } finally {
      isProcessingTranscript = false;
    }
  }

  /**
   * Safely send message to tab using callback syntax to consume chrome.runtime.lastError
   * and prevent Chrome from logging Uncaught (in promise) Receiving end does not exist errors
   */
  function sendTabMessageSafe(tabId, message) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) {
            // Explicitly reading chrome.runtime.lastError marks it as handled in Chromium
            const _err = chrome.runtime.lastError.message;
            resolve(null);
          } else {
            resolve(response !== undefined ? response : { success: true });
          }
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  /**
   * Send message to active Chrome tab with auto-injection fallback and error handling
   */
  async function sendToActiveTab(message) {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) {
      return { success: false, error: 'Chrome extension APIs unavailable.' };
    }

    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab || !activeTab.id) {
        return { success: false, error: 'No active tab found.' };
      }

      const rawUrl = activeTab.url || '';
      const url = rawUrl.toLowerCase();

      // Auto-navigate to Google on New Tab pages when searching or enabling blind mode
      if (url.startsWith('chrome://newtab') || url.startsWith('chrome-search://') || url === 'about:blank') {
        if (message.action === 'GO_TO_SEARCH' || message.action === 'EXECUTE_SEARCH' || message.action === 'SET_BLIND_MODE') {
          await chrome.tabs.update(activeTab.id, { url: 'https://www.google.com' });
          return { success: true, message: 'Opening Google Search...' };
        }
      }

      const isRestrictedUrl =
        url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('chrome-search://') ||
        url.startsWith('edge://') ||
        url.startsWith('extension://') ||
        url.startsWith('brave://') ||
        url.startsWith('opera://') ||
        url.startsWith('vivaldi://') ||
        url.startsWith('about:') ||
        url.startsWith('moz-extension://') ||
        url.includes('chrome.google.com/webstore') ||
        url.includes('chromewebstore.google.com') ||
        url.includes('microsoftedge.microsoft.com/addons') ||
        url.includes('addons.mozilla.org');

      if (isRestrictedUrl) {
        if (message.action === 'EXECUTE_SEARCH' && message.query) {
          await chrome.tabs.update(activeTab.id, { url: `https://www.google.com/search?q=${encodeURIComponent(message.query)}` });
          return { success: true, message: 'Navigating to Google Search...' };
        } else if (message.action === 'GO_TO_SEARCH') {
          await chrome.tabs.update(activeTab.id, { url: 'https://www.google.com' });
          return { success: true, message: 'Opening Google Search...' };
        }
        return { success: false, error: 'Handsfree is not supported on Chrome system or Webstore pages.' };
      }

      // 1. Try direct messaging safely without throwing unchecked errors
      const directResponse = await sendTabMessageSafe(activeTab.id, message);
      if (directResponse) return directResponse;

      // 2. Fallback: Programmatically inject content script on demand
      if (chrome.scripting && chrome.scripting.executeScript) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: ['content.js']
          });

          await new Promise(r => setTimeout(r, 120));

          const retryResponse = await sendTabMessageSafe(activeTab.id, message);
          if (retryResponse) return retryResponse;
        } catch (injectErr) {
          console.warn('[Handsfree] Content script injection fallback:', injectErr);
          if (message.action === 'EXECUTE_SEARCH' && message.query) {
            await chrome.tabs.update(activeTab.id, { url: `https://www.google.com/search?q=${encodeURIComponent(message.query)}` });
            return { success: true, message: 'Navigating to Google Search...' };
          } else if (message.action === 'GO_TO_SEARCH') {
            await chrome.tabs.update(activeTab.id, { url: 'https://www.google.com' });
            return { success: true, message: 'Opening Google Search...' };
          }
          return { success: false, error: 'Cannot access page content on this tab.' };
        }
      }

      // Final fallback for search actions
      if (message.action === 'EXECUTE_SEARCH' && message.query) {
        await chrome.tabs.update(activeTab.id, { url: `https://www.google.com/search?q=${encodeURIComponent(message.query)}` });
        return { success: true, message: 'Navigating to Google Search...' };
      }

      // Final fallback for search actions
      if (message.action === 'EXECUTE_SEARCH' && message.query) {
        await chrome.tabs.update(activeTab.id, { url: `https://www.google.com/search?q=${encodeURIComponent(message.query)}` });
        return { success: true, message: 'Navigating to Google Search...' };
      }

      return { success: false, error: 'Could not connect to active page.' };

    } catch (err) {
      console.warn('[Handsfree] sendToActiveTab error:', err);
      return { success: false, error: err.message || 'Tab messaging error.' };
    }
  }

  // --- TTS & Webpage Reading Manager ---
  let ttsAudio = null;
  let ttsAudioContext = null;
  let activeAudioSource = null;
  let readingSections = [];
  let currentReadingIndex = -1;
  let isReadingActive = false;
  let isTtsSpeaking = false;

  const readingProgress = document.getElementById('readingProgress');
  const readPlayBtn = document.getElementById('readPlayBtn');
  const readPauseBtn = document.getElementById('readPauseBtn');
  const readStopBtn = document.getElementById('readStopBtn');
  const prevSecBtn = document.getElementById('prevSecBtn');
  const nextSecBtn = document.getElementById('nextSecBtn');
  const repeatSecBtn = document.getElementById('repeatSecBtn');

  function updateReaderUIState(statusText, canPause = false, canStop = false) {
    if (readingProgress) readingProgress.textContent = statusText;
    if (readPauseBtn) readPauseBtn.disabled = !canPause;
    if (readStopBtn) readStopBtn.disabled = !canStop;
  }

  function ensureAudioContext() {
    try {
      if (!ttsAudioContext || ttsAudioContext.state === 'closed') {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          ttsAudioContext = new AudioCtx();
        }
      }
      if (ttsAudioContext && ttsAudioContext.state === 'suspended') {
        ttsAudioContext.resume().catch(() => { });
      }
    } catch (e) {
      console.warn('[Handsfree AudioContext] Init warning:', e);
    }
    return ttsAudioContext;
  }

  function playBase64WithAudioContext(base64Audio) {
    return new Promise((resolve, reject) => {
      try {
        const ctx = ensureAudioContext();
        if (!ctx) {
          return reject(new Error('AudioContext not supported'));
        }

        const binary = atob(base64Audio);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binary.charCodeAt(i);
        }

        ctx.decodeAudioData(bytes.buffer.slice(0), (audioBuffer) => {
          try {
            stopTtsPlayback();
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(ctx.destination);
            activeAudioSource = source;
            isTtsSpeaking = true;

            source.onended = () => {
              isTtsSpeaking = false;
              activeAudioSource = null;
              resolve();
            };

            source.start(0);
            updateReaderUIState('Reading...', true, true);
          } catch (playErr) {
            reject(playErr);
          }
        }, (decodeErr) => {
          reject(decodeErr || new Error('AudioContext decode failed'));
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  function playHtml5Audio(base64Audio) {
    return new Promise((resolve, reject) => {
      try {
        stopTtsPlayback();
        const binary = atob(base64Audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes.buffer], { type: 'audio/wav' });
        const blobUrl = URL.createObjectURL(blob);

        ttsAudio = new Audio(blobUrl);

        ttsAudio.onended = () => {
          URL.revokeObjectURL(blobUrl);
          isTtsSpeaking = false;
          ttsAudio = null;
          resolve();
        };

        ttsAudio.onerror = (e) => {
          URL.revokeObjectURL(blobUrl);
          isTtsSpeaking = false;
          ttsAudio = null;
          reject(new Error('HTML5 Audio playback error'));
        };

        const playPromise = ttsAudio.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            isTtsSpeaking = true;
            updateReaderUIState('Reading...', true, true);
          }).catch((playErr) => {
            URL.revokeObjectURL(blobUrl);
            reject(playErr);
          });
        } else {
          isTtsSpeaking = true;
          updateReaderUIState('Reading...', true, true);
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  function speakWithBrowserSynth(text) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) {
        resolve();
        return;
      }
      stopTtsPlayback();
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      utterance.onend = () => {
        isTtsSpeaking = false;
        resolve();
      };

      utterance.onerror = (e) => {
        console.warn('[Handsfree TTS] Browser speech synthesis error:', e);
        isTtsSpeaking = false;
        resolve();
      };

      isTtsSpeaking = true;
      updateReaderUIState('Reading...', true, true);
      window.speechSynthesis.speak(utterance);
    });
  }

  /**
   * Synthesize text to speech via Sarvam TTS (with Web Audio & browser synth fallback)
   */
  async function speakText(text) {
    if (!text || text.trim().length === 0) return;

    stopTtsPlayback();
    stopAudioStream();

    isTtsSpeaking = true;
    updateReaderUIState('Synthesizing...', false, true);

    // 1. Try Sarvam TTS via Express backend
    try {
      const res = await fetch(getTtsUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, speaker: 'simran_en_narration', model: 'bulbul:v4-flash' })
      });

      const data = await res.json();
      if (!res.ok || !data.success || !data.audio_base64) {
        throw new Error(data.error || `TTS synthesis failed with status ${res.status}`);
      }

      // Play audio: Web Audio API first (no HTMLMediaElement autoplay policy blockage)
      try {
        await playBase64WithAudioContext(data.audio_base64);
        return;
      } catch (audioCtxErr) {
        console.warn('[Handsfree TTS] AudioContext playback failed, attempting HTML5 Audio:', audioCtxErr);
        await playHtml5Audio(data.audio_base64);
        return;
      }
    } catch (sarvamErr) {
      console.warn('[Handsfree TTS] Sarvam TTS playback failed, falling back to browser SpeechSynthesis:', sarvamErr);
    }

    // 2. Resilient Fallback: Browser Native SpeechSynthesis
    try {
      await speakWithBrowserSynth(text);
    } catch (synthErr) {
      console.error('[Handsfree TTS] All TTS methods failed:', synthErr);
      isTtsSpeaking = false;
      messageText.textContent = `TTS Error: ${synthErr.message}`;
      updateReaderUIState('TTS Error', false, false);
    }
  }

  function stopTtsPlayback() {
    if (activeAudioSource) {
      try {
        activeAudioSource.stop();
      } catch (e) { }
      activeAudioSource = null;
    }
    if (ttsAudio) {
      ttsAudio.onended = null;
      ttsAudio.onerror = null;
      try {
        ttsAudio.pause();
        ttsAudio.currentTime = 0;
      } catch (e) { }
      ttsAudio = null;
    }
    if (window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) { }
    }
    isTtsSpeaking = false;
  }

  /**
   * Start reading webpage content
   */
  async function startReadingPage() {
    stopTtsPlayback();
    stopAudioStream();

    setActiveMode(Mode.READING);
    isReadingActive = true;
    currentReadingIndex = 0;
    messageText.textContent = 'Extracting webpage content for reading...';

    const response = await sendToActiveTab({ action: 'GET_READABLE_SECTIONS' });

    if (!response || !response.success || !response.sections || response.sections.length === 0) {
      messageText.textContent = response?.error || 'Could not find readable content on active page.';
      updateReaderUIState('No content', false, false);
      isReadingActive = false;
      return;
    }

    readingSections = response.sections;
    messageText.textContent = `Reading started (${readingSections.length} sections found).`;
    readCurrentSection();
  }

  async function readCurrentSection() {
    if (!isReadingActive || currentReadingIndex < 0 || currentReadingIndex >= readingSections.length) {
      stopReadingPage();
      return;
    }

    const section = readingSections[currentReadingIndex];
    updateReaderUIState(`Sec ${currentReadingIndex + 1}/${readingSections.length}`, true, true);

    await sendToActiveTab({ action: 'HIGHLIGHT_SECTION', index: currentReadingIndex });

    // Speak section text and WAIT until audio completely finishes playing!
    await speakText(section.text);

    // If reading was cancelled during TTS, exit cleanly
    if (!isReadingActive) return;

    updateReaderUIState(`Sec ${currentReadingIndex + 1}/${readingSections.length} (Listening)`, true, true);
    messageText.textContent = `Question ${currentReadingIndex + 1} read. Listening for your answer (say "next" to advance)...`;

    // Automatically activate microphone AFTER TTS finishes speaking!
    setTimeout(() => {
      if (isReadingActive && currentState !== State.RECORDING && currentState !== State.REQUESTING && !isTtsSpeaking) {
        startRecording();
      }
    }, 400);
  }

  function pauseOrResumeReading() {
    if (ttsAudioContext && ttsAudioContext.state === 'running') {
      ttsAudioContext.suspend();
      isTtsSpeaking = false;
      updateReaderUIState('Paused', true, true);
      return;
    } else if (ttsAudioContext && ttsAudioContext.state === 'suspended') {
      ttsAudioContext.resume();
      isTtsSpeaking = true;
      updateReaderUIState('Reading...', true, true);
      return;
    }

    if (window.speechSynthesis && window.speechSynthesis.speaking) {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        isTtsSpeaking = true;
        updateReaderUIState('Reading...', true, true);
      } else {
        window.speechSynthesis.pause();
        isTtsSpeaking = false;
        updateReaderUIState('Paused', true, true);
      }
      return;
    }

    if (ttsAudio) {
      if (ttsAudio.paused) {
        ttsAudio.play().catch(() => { });
        isTtsSpeaking = true;
        updateReaderUIState('Reading...', true, true);
      } else {
        ttsAudio.pause();
        isTtsSpeaking = false;
        updateReaderUIState('Paused', true, true);
      }
    }
  }

  function stopReadingPage() {
    isReadingActive = false;
    currentReadingIndex = -1;
    stopTtsPlayback();
    sendToActiveTab({ action: 'CLEAR_HIGHLIGHT' });
    updateReaderUIState('Stopped', false, false);
  }

  function readNextSection() {
    if (readingSections.length === 0) {
      startReadingPage();
      return;
    }
    if (currentReadingIndex < readingSections.length - 1) {
      currentReadingIndex++;
      readCurrentSection();
    }
  }

  function readPreviousSection() {
    if (currentReadingIndex > 0) {
      currentReadingIndex--;
      readCurrentSection();
    }
  }

  function repeatCurrentSection() {
    if (currentReadingIndex >= 0 && currentReadingIndex < readingSections.length) {
      readCurrentSection();
    }
  }

  async function readSelectedText() {
    const res = await sendToActiveTab({ action: 'GET_SELECTED_TEXT' });
    if (res && res.text) {
      messageText.textContent = `Reading selection: "${res.text.slice(0, 30)}..."`;
      speakText(res.text);
    } else {
      messageText.textContent = res?.error || 'No text selected. Highlight text on page first!';
    }
  }

  // --- Numbered Link Overlay (Click-by-Voice) ---

  let isNumbersOverlayActive = false;

  async function toggleNumberedLinksOverlay() {
    const res = await sendToActiveTab({ action: 'TOGGLE_NUMBERED_LINKS' });
    if (res && res.success) {
      isNumbersOverlayActive = !isNumbersOverlayActive;
      updateNumbersBtnUI(isNumbersOverlayActive, res.count);
      if (isNumbersOverlayActive) {
        setUIState(State.COMPLETED, `Numbered links active (${res.count || 0} items). Say "Click [number]".`);
        speakText(`Numbered links shown. ${res.count || ''} items found.`);
      } else {
        setUIState(State.COMPLETED, 'Numbered links hidden.');
      }
    }
  }

  function updateNumbersBtnUI(active, count) {
    if (!toggleNumbersBtn) return;
    if (active) {
      toggleNumbersBtn.classList.add('active');
      if (toggleNumbersText) {
        toggleNumbersText.textContent = `Hide Numbered Links (${count || ''})`;
      }
    } else {
      toggleNumbersBtn.classList.remove('active');
      if (toggleNumbersText) {
        toggleNumbersText.textContent = 'Show Numbered Links';
      }
    }
  }

  async function syncNumberedLinksStatus() {
    const res = await sendToActiveTab({ action: 'GET_NUMBERED_LINKS_STATUS' });
    if (res && res.success) {
      isNumbersOverlayActive = res.isVisible;
      updateNumbersBtnUI(res.isVisible, res.count);
    }
  }

  function extractSpokenNumber(text, isExplicitClickOnly = false) {
    if (!text) return null;
    const clean = text.toLowerCase().replace(/[^\w\s#]/g, '').trim();

    // 1. If in dictation or reading mode, ONLY trigger if the user explicitly says an action verb:
    // e.g. "click link 5", "click 5", "open 12", "press 4"
    if (isExplicitClickOnly) {
      const explicitMatch = clean.match(/^(?:click|open|press|go\s*to)\s+(?:link\s+|number\s+|#)?(\d{1,3})\b/i);
      if (explicitMatch && explicitMatch[1]) {
        return parseInt(explicitMatch[1], 10);
      }
      return null;
    }

    // 2. Explicit prefix match: "click 5", "open link 12", "number 8", "link 4"
    const prefixMatch = clean.match(/^(?:click|open|press|select|go\s*to|number|link)\s+#?(\d{1,3})\b/i);
    if (prefixMatch && prefixMatch[1]) {
      return parseInt(prefixMatch[1], 10);
    }

    // 3. Only if Numbered Links are currently VISIBLE on screen, allow standalone small numbers (1 to 300)
    // NEVER match 10-digit phone numbers or multi-digit form numbers
    if (isNumbersOverlayActive) {
      const standaloneMatch = clean.match(/^#?(\d{1,3})$/);
      if (standaloneMatch && standaloneMatch[1]) {
        const n = parseInt(standaloneMatch[1], 10);
        if (n >= 1 && n <= 300) return n;
      }

      // Word numbers: standalone words like "five", "twelve"
      const wordsToNum = {
        one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
        eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
        twenty: 20
      };

      for (const [w, n] of Object.entries(wordsToNum)) {
        const wordPattern = new RegExp(`^(?:click|open|link)?\\s*\\b${w}\\b$`, 'i');
        if (wordPattern.test(clean)) {
          return n;
        }
      }
    }

    return null;
  }

  /**
   * Deterministic Voice Command Parser
   * Matches commands strictly and routes to action handlers
   */
  function executeVoiceCommand(cmdText) {
    if (!cmdText) return;

    // Normalise transcript text (lowercase, remove punctuation, collapse whitespace)
    let text = cmdText.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    console.log('[Handsfree Command] Executing normalized command:', text);

    // Convert spoken word numbers 1-10 to digits for flexible pattern matching
    const wordDigits = {
      one: '1', two: '2', three: '3', four: '4', five: '5',
      six: '6', seven: '7', eight: '8', nine: '9', ten: '10'
    };
    for (const [w, d] of Object.entries(wordDigits)) {
      text = text.replace(new RegExp(`\\b${w}\\b`, 'g'), d);
    }

    // Eyes-Free Blind Mode Activation / Deactivation
    if (text === 'blind mode' || text === 'eyes free' || text === 'eyes free mode' || text === 'enable blind mode' || text === 'start blind mode') {
      messageText.textContent = 'Command: Enable Eyes-Free Blind Mode';
      updateBlindModeState(true);
      return;
    } else if (text === 'disable blind mode' || text === 'stop blind mode' || text === 'exit blind mode' || text === 'turn off blind mode') {
      messageText.textContent = 'Command: Disable Eyes-Free Blind Mode';
      updateBlindModeState(false);
      return;
    }

    // Direct Search Bar Auto-Focus & Glide
    if (text === 'go to search' || text === 'cursor go to search' || text === 'search bar' || text === 'focus search' || text === 'search input' || text === 'find search') {
      messageText.textContent = 'Command: Go to search';
      sendToActiveTab({ action: 'GO_TO_SEARCH' }).then(res => {
        if (res && res.success) {
          setUIState(State.COMPLETED, res.message || 'Search input focused. Dictate query and say "Done".');
        } else {
          // If on a restricted page, automatically navigate to Google Search!
          if (res?.error && (res.error.includes('system') || res.error.includes('Chrome'))) {
            chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
              if (tab?.id) chrome.tabs.update(tab.id, { url: 'https://www.google.com' });
            });
            setUIState(State.COMPLETED, 'Opening Google Search...');
          } else {
            setUIState(State.ERROR, res?.error || 'Could not find search bar on page.');
          }
        }
      });
      return;
    }

    // Dictate Search Term -> Say "Done"
    if (text === 'done' || text === 'finished' || text === 'query done' || text === 'done typing' || text === 'search done') {
      messageText.textContent = 'Command: Query finished';
      sendToActiveTab({ action: 'FINISH_QUERY', query: lastDictatedSearchQuery }).then(res => {
        if (res && res.success) {
          setUIState(State.COMPLETED, `Query ready: "${res.query || lastDictatedSearchQuery || ''}". Say "Search" to execute.`);
        } else {
          setUIState(State.COMPLETED, 'Query finished. Say "Search" to execute.');
        }
      });
      return;
    }

    // Search Execution -> Say "Search"
    if (text === 'search' || text === 'execute search' || text === 'submit search' || text === 'run search' || text === 'google search') {
      messageText.textContent = 'Command: Execute search';
      sendToActiveTab({ action: 'EXECUTE_SEARCH', query: lastDictatedSearchQuery }).then(res => {
        if (res && res.success) {
          setUIState(State.COMPLETED, 'Search submitted.');
        } else {
          setUIState(State.ERROR, res?.error || 'Could not submit search.');
        }
      });
      return;
    }

    // Link Reader -> Say "Read links" / "Read results" / "Read hotels"
    if (
      text === 'read' ||
      text === 'read links' ||
      text === 'read results' ||
      text === 'read top links' ||
      text === 'read search results' ||
      text === 'read result links' ||
      text === 'read hotels' ||
      text === 'read top hotels' ||
      text === 'read places' ||
      text === 'read restaurants' ||
      text === 'what are the hotels' ||
      text === 'what are the results' ||
      text === 'tell me the results' ||
      text === 'tell me the hotels' ||
      text === 'repeat results'
    ) {
      messageText.textContent = 'Command: Read search results';
      sendToActiveTab({ action: 'READ_SEARCH_RESULTS' }).then(res => {
        if (res && res.success) {
          setUIState(State.COMPLETED, `Reading ${res.count || 0} results. Say "Click link 1" to open.`);
        } else {
          setUIState(State.ERROR, res?.error || 'No search results found to read.');
        }
      });
      return;
    }

    // Direct Search Result Click ("Click link 1", "Click 1", "Open result 1", "Click hotel 1", "Hotel 1")
    const searchResultMatch = text.match(/^(?:click|open)\s+(?:link\s+|result\s+|hotel\s+|place\s+)?(\d{1,2})$/) || text.match(/^(?:link|result|hotel|place)\s+(\d{1,2})$/);
    if (searchResultMatch && searchResultMatch[1]) {
      const resultIndex = parseInt(searchResultMatch[1], 10);
      messageText.textContent = `Command: Open result #${resultIndex}`;
      sendToActiveTab({ action: 'CLICK_SEARCH_RESULT', number: resultIndex }).then(res => {
        if (res && res.success) {
          setUIState(State.COMPLETED, `Opening result #${resultIndex}: "${res.title}"`);
        } else {
          // Fallback to standard numbered link overlay selection
          sendToActiveTab({ action: 'CLICK_NUMBERED_LINK', number: resultIndex }).then(numRes => {
            if (numRes && numRes.success) {
              setUIState(State.COMPLETED, `Clicked #${resultIndex}: "${numRes.label}"`);
              speakText(`Selected ${numRes.label || resultIndex}`);
            } else {
              setUIState(State.ERROR, res?.error || numRes?.error || `Link #${resultIndex} not found.`);
            }
          });
        }
      });
      return;
    }

    // Numbered Links Voice Commands
    if (text === 'show numbers' || text === 'show links' || text === 'show badges' || text === 'numbers') {
      messageText.textContent = 'Command: Show numbered links';
      sendToActiveTab({ action: 'SHOW_NUMBERED_LINKS' }).then(res => {
        isNumbersOverlayActive = true;
        updateNumbersBtnUI(true, res?.count);
        setUIState(State.COMPLETED, `Showing ${res?.count || 0} numbered links.`);
        speakText(`Showing ${res?.count || ''} links.`);
      });
      return;
    } else if (text === 'hide numbers' || text === 'hide links' || text === 'hide badges') {
      messageText.textContent = 'Command: Hide numbered links';
      sendToActiveTab({ action: 'HIDE_NUMBERED_LINKS' }).then(() => {
        isNumbersOverlayActive = false;
        updateNumbersBtnUI(false, 0);
        setUIState(State.COMPLETED, 'Hidden link numbers.');
      });
      return;
    }

    // Numbered link selection (e.g. "click 5", "open 12", "number 3", "7")
    const targetLinkNum = extractSpokenNumber(cmdText);
    if (targetLinkNum !== null) {
      messageText.textContent = `Command: Click link #${targetLinkNum}`;
      sendToActiveTab({ action: 'CLICK_NUMBERED_LINK', number: targetLinkNum }).then(res => {
        if (res && res.success) {
          setUIState(State.COMPLETED, `Clicked #${targetLinkNum}: "${res.label}"`);
          speakText(`Selected ${res.label || targetLinkNum}`);
        } else {
          setUIState(State.ERROR, res?.error || `Link #${targetLinkNum} not found.`);
        }
      });
      return;
    }

    if (text === 'next' || text === 'read next' || text === 'next section' || text === 'go next') {
      messageText.textContent = 'Command: Next section';
      readNextSection();
    } else if (text === 'previous' || text === 'read previous' || text === 'previous section' || text === 'prev') {
      messageText.textContent = 'Command: Previous section';
      readPreviousSection();
    } else if (text === 'start reading' || text === 'read page' || text === 'read webpage') {
      messageText.textContent = 'Command: Start reading page';
      startReadingPage();
    } else if (text === 'pause' || text === 'pause reading') {
      messageText.textContent = 'Command: Pause reading';
      pauseOrResumeReading();
    } else if (text === 'resume' || text === 'resume reading' || text === 'continue reading') {
      messageText.textContent = 'Command: Resume reading';
      pauseOrResumeReading();
    } else if (text === 'stop' || text === 'stop reading') {
      messageText.textContent = 'Command: Stop reading';
      stopReadingPage();
    } else if (text === 'repeat' || text === 'repeat that' || text === 'repeat section') {
      messageText.textContent = 'Command: Repeat section';
      repeatCurrentSection();
    } else if (text === 'scroll down' || text === 'page down') {
      messageText.textContent = 'Command: Scroll down';
      sendToActiveTab({ action: 'SCROLL', direction: 'down' });
    } else if (text === 'scroll up' || text === 'page up') {
      messageText.textContent = 'Command: Scroll up';
      sendToActiveTab({ action: 'SCROLL', direction: 'up' });
    } else if (text === 'read selected' || text === 'read selection') {
      messageText.textContent = 'Command: Read selected text';
      readSelectedText();
    } else if (isBackspaceCommand(text)) {
      messageText.textContent = 'Command: Backspace word';
      sendToActiveTab({ action: 'BACKSPACE_WORD' });
    } else if (isClearCommand(text)) {
      messageText.textContent = 'Command: Clear text field';
      sendToActiveTab({ action: 'CLEAR_TEXT' });
    } else if (text === 'undo' || text === 'uncheck' || text === 'deselect' || text === 'clear options') {
      messageText.textContent = 'Command: Undo / uncheck options';
      sendToActiveTab({ action: 'UNDO_CHECKED_OPTIONS', sectionIndex: currentReadingIndex });
    } else if (text === 'submit' || text === 'submit form' || text === 'send form') {
      messageText.textContent = 'Command: Submit form';
      sendToActiveTab({ action: 'SUBMIT_FORM' });
      speakText('Submitting form.');
    } else if (text === 'dictation' || text === 'start dictation' || text === 'dictation mode') {
      setActiveMode(Mode.DICTATION);
      messageText.textContent = 'Switched to Dictation Mode.';
    } else if (text === 'command' || text === 'command mode' || text === 'stop dictation') {
      setActiveMode(Mode.COMMAND);
      messageText.textContent = 'Switched to Command Mode.';
    } else if (text === 'cancel') {
      stopRecording();
      stopReadingPage();
      messageText.textContent = 'Cancelled.';
    } else {
      messageText.textContent = `Unrecognized command: "${cmdText}". Try "Next" or "Start reading".`;
    }
  }

  // --- Event Listeners ---

  startBtn.addEventListener('click', () => {
    ensureAudioContext();
    startRecording();
  });

  stopBtn.addEventListener('click', stopRecording);

  if (modeCommandBtn) modeCommandBtn.addEventListener('click', () => setActiveMode(Mode.COMMAND));
  if (modeDictationBtn) modeDictationBtn.addEventListener('click', () => setActiveMode(Mode.DICTATION));
  if (modeReadingBtn) modeReadingBtn.addEventListener('click', () => setActiveMode(Mode.READING));
  if (modeBlindBtn) modeBlindBtn.addEventListener('click', () => updateBlindModeState(true));

  if (blindModeToggle) {
    blindModeToggle.addEventListener('change', (e) => {
      updateBlindModeState(e.target.checked);
    });
  }

  // Keyboard shortcut Alt+B inside popup
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      const newState = !blindModeToggle?.checked;
      updateBlindModeState(newState);
    }
  });

  if (readPlayBtn) readPlayBtn.addEventListener('click', () => {
    ensureAudioContext();
    startReadingPage();
  });
  if (readPauseBtn) readPauseBtn.addEventListener('click', pauseOrResumeReading);
  if (readStopBtn) readStopBtn.addEventListener('click', stopReadingPage);
  if (prevSecBtn) prevSecBtn.addEventListener('click', () => {
    ensureAudioContext();
    readPreviousSection();
  });
  if (nextSecBtn) nextSecBtn.addEventListener('click', () => {
    ensureAudioContext();
    readNextSection();
  });
  if (repeatSecBtn) repeatSecBtn.addEventListener('click', () => {
    ensureAudioContext();
    repeatCurrentSection();
  });

  if (grantMicBtn) {
    grantMicBtn.addEventListener('click', openPermissionTab);
  }

  if (openGoogleBtn) {
    openGoogleBtn.addEventListener('click', async () => {
      if (chrome.tabs) {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.id) {
          await chrome.tabs.update(activeTab.id, { url: 'https://www.google.com' });
        } else {
          await chrome.tabs.create({ url: 'https://www.google.com' });
        }
      }
    });
  }

  if (toggleNumbersBtn) {
    toggleNumbersBtn.addEventListener('click', toggleNumberedLinksOverlay);
  }

  if (openBenchmarkBtn) {
    openBenchmarkBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'http://localhost:5173' });
    });
  }

  copyBtn.addEventListener('click', async () => {
    const text = transcriptText.innerText;
    if (text && !transcriptText.classList.contains('placeholder-text')) {
      try {
        await navigator.clipboard.writeText(text);
        const origMsg = messageText.textContent;
        messageText.textContent = 'Copied transcript to clipboard!';
        setTimeout(() => {
          messageText.textContent = origMsg;
        }, 2000);
      } catch (e) {
        console.error('Copy failed', e);
      }
    }
  });

  // Ensure stream and TTS cleanup when popup closes
  window.addEventListener('beforeunload', () => {
    stopAudioStream();
    stopTtsPlayback();
  });

  // Initial setup
  setActiveMode(Mode.COMMAND);
  setUIState(State.IDLE);
  checkBackendHealth();
  syncNumberedLinksStatus();
  syncBlindModeStatus();
});



