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

  // Backend Health Check URL
  const BACKEND_HEALTH_URL = 'http://localhost:5000/api/health';

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
        statusText.textContent = 'Error';
        messageBox.classList.add('message-error');
        messageText.textContent = customMessage || 'An error occurred. Please try again.';
        if (grantMicBtn && (customMessage.includes('tab') || customMessage.includes('permission') || customMessage.includes('denied'))) {
          grantMicBtn.classList.remove('hidden');
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
      const response = await fetch(BACKEND_HEALTH_URL, { method: 'GET' });
      if (response.ok) {
        const data = await response.json();
        if (data && data.status === 'ok') {
          backendIndicator.classList.add('backend-online');
          backendIndicator.classList.remove('backend-offline');
          backendIndicator.title = 'Express Backend is online';
          return;
        }
      }
      throw new Error('Invalid backend response');
    } catch (err) {
      backendIndicator.classList.add('backend-offline');
      backendIndicator.classList.remove('backend-online');
      backendIndicator.title = 'Backend offline (localhost:5000)';
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
      } catch (e) {}
    }
    mediaRecorder = null;

    if (mediaStream) {
      mediaStream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (e) {}
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
      mediaRecorder.onstop = async () => {
        clearInterval(recordingTimer);
        const actualMime = mediaRecorder.mimeType || mimeType || 'audio/webm';
        recordedAudioBlob = new Blob(audioChunks, { type: actualMime });
        
        // Stop hardware mic stream
        stopAudioStream();

        const blobSizeKB = (recordedAudioBlob.size / 1024).toFixed(1);
        console.log(`[Handsfree] Audio recording stopped. Blob size: ${blobSizeKB} KB, Type: ${actualMime}`);

        if (recordedAudioBlob.size === 0) {
          setUIState(State.ERROR, 'Recorded audio was empty. Please try again.');
          if (isReadingActive) {
            setTimeout(() => {
              if (isReadingActive && currentState !== State.RECORDING && currentState !== State.REQUESTING && !isTtsSpeaking) {
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
    READING: 'reading'
  };

  // State Management
  let activeMode = Mode.COMMAND; // Default mode is COMMAND
  let isProcessingTranscript = false;

  const modeCommandBtn = document.getElementById('modeCommand');
  const modeDictationBtn = document.getElementById('modeDictation');
  const modeReadingBtn = document.getElementById('modeReading');

  /**
   * Switch Active Extension Mode
   */
  function setActiveMode(mode) {
    activeMode = mode;

    [modeCommandBtn, modeDictationBtn, modeReadingBtn].forEach(btn => {
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
    }
  }

  /**
   * Upload audio blob to Express backend and route transcript based on ACTIVE MODE
   */
  async function sendAudioForTranscription(blob, mimeType) {
    if (isProcessingTranscript) return;
    isProcessingTranscript = true;

    const TRANSCRIBE_URL = 'http://localhost:5000/api/transcribe';
    setUIState(State.TRANSCRIBING, 'Transcribing audio with Sarvam AI...');

    try {
      const formData = new FormData();
      const filename = mimeType.includes('mp4') ? 'audio.mp4' : 'audio.webm';
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

        // Auto re-listen if conversational reading is active
        if (isReadingActive) {
          console.log('[Handsfree Conversational] No speech detected. Re-listening...');
          setTimeout(() => {
            if (isReadingActive && currentState !== State.RECORDING && currentState !== State.REQUESTING && !isTtsSpeaking) {
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
      } else if (activeMode === Mode.DICTATION || activeMode === Mode.READING) {
        // Standard navigation voice commands during reading
        const isStandardNavCommand = [
          'previous', 'prev', 'read previous', 'previous section',
          'repeat', 'repeat that', 'repeat section',
          'scroll down', 'scroll up', 'page down', 'page up',
          'pause', 'pause reading', 'resume', 'resume reading',
          'stop', 'stop reading', 'cancel'
        ].includes(lower);

        if (isStandardNavCommand) {
          executeVoiceCommand(transcript);
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

      console.log('[Handsfree] Transcription result:', data);

    } catch (err) {
      console.error('[Handsfree] Transcription fetch error:', err);
      setUIState(State.ERROR, `Transcription error: ${err.message}`);
    } finally {
      isProcessingTranscript = false;
    }
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

      const url = activeTab.url || '';
      const isRestrictedUrl = 
        url.startsWith('chrome://') || 
        url.startsWith('chrome-extension://') || 
        url.startsWith('chrome-search://') || 
        url.startsWith('edge://') || 
        url.startsWith('about:') || 
        url.includes('chrome.google.com/webstore') ||
        url.includes('chromewebstore.google.com');

      if (isRestrictedUrl) {
        return { success: false, error: 'Handsfree is not supported on Chrome system or Webstore pages.' };
      }

      // 1. Try direct messaging
      try {
        const response = await chrome.tabs.sendMessage(activeTab.id, message);
        if (response !== undefined) return response;
      } catch (msgErr) {
        // Connection failed; content script might not be loaded on tab yet
      }

      // 2. Fallback: Programmatically inject content script on demand
      if (chrome.scripting && chrome.scripting.executeScript) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: ['content.js']
          });
          
          await new Promise(r => setTimeout(r, 100));

          const retryResponse = await chrome.tabs.sendMessage(activeTab.id, message);
          return retryResponse || { success: true };
        } catch (injectErr) {
          console.warn('[Handsfree] Content script injection failed:', injectErr);
          return { success: false, error: 'Cannot access page content on this tab.' };
        }
      }

      return { success: false, error: 'Could not connect to active page.' };

    } catch (err) {
      console.warn('[Handsfree] sendToActiveTab error:', err);
      return { success: false, error: err.message || 'Tab messaging error.' };
    }
  }

  /**
   * Check backend express API health
   */
  async function checkBackendHealth() {
    try {
      const response = await fetch(BACKEND_HEALTH_URL, { method: 'GET' });
      if (response.ok) {
        const data = await response.json();
        if (data && data.status === 'ok') {
          backendIndicator.classList.add('backend-online');
          backendIndicator.classList.remove('backend-offline');
          backendIndicator.title = 'Express Backend is online';
          return;
        }
      }
      throw new Error('Invalid backend response');
    } catch (err) {
      backendIndicator.classList.add('backend-offline');
      backendIndicator.classList.remove('backend-online');
      backendIndicator.title = 'Backend offline (localhost:5000)';
    }
  }

  // --- TTS & Webpage Reading Manager ---
  const BACKEND_TTS_URL = 'http://localhost:5000/api/tts';
  let ttsAudio = new Audio();
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

  /**
   * Synthesize text to speech via Sarvam TTS and play audio
   * Returns a Promise that resolves only when audio finishes playing naturally
   */
  function speakText(text) {
    return new Promise(async (resolve) => {
      if (!text || text.trim().length === 0) {
        resolve();
        return;
      }
      
      stopTtsPlayback();
      stopAudioStream();

      try {
        isTtsSpeaking = true;
        updateReaderUIState('Synthesizing...', false, true);
        
        const res = await fetch(BACKEND_TTS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, speaker: 'simran_en_narration', model: 'bulbul:v4-flash' })
        });

        const data = await res.json();
        if (!res.ok || !data.success || !data.audio_base64) {
          throw new Error(data.error || 'TTS synthesis failed');
        }

        ttsAudio = new Audio(`data:audio/wav;base64,${data.audio_base64}`);
        
        ttsAudio.onended = () => {
          isTtsSpeaking = false;
          ttsAudio = null;
          resolve();
        };

        ttsAudio.onerror = (e) => {
          console.error('[Handsfree TTS] Audio playback error:', e);
          isTtsSpeaking = false;
          ttsAudio = null;
          updateReaderUIState('Playback error', false, false);
          resolve();
        };

        await ttsAudio.play();
        updateReaderUIState('Reading...', true, true);

      } catch (err) {
        isTtsSpeaking = false;
        console.error('[Handsfree TTS] Error speaking text:', err);
        messageText.textContent = `TTS Error: ${err.message}`;
        updateReaderUIState('TTS Error', false, false);
        resolve();
      }
    });
  }

  function stopTtsPlayback() {
    if (ttsAudio) {
      ttsAudio.onended = null;
      ttsAudio.onerror = null;
      try {
        ttsAudio.pause();
        ttsAudio.currentTime = 0;
      } catch (e) {}
      ttsAudio = null;
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
    if (!ttsAudio || !ttsAudio.src) return;

    if (ttsAudio.paused) {
      ttsAudio.play();
      isTtsSpeaking = true;
      updateReaderUIState('Reading...', true, true);
    } else {
      ttsAudio.pause();
      isTtsSpeaking = false;
      updateReaderUIState('Paused', true, true);
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

  /**
   * Deterministic Voice Command Parser
   * Matches commands strictly and routes to action handlers
   */
  function executeVoiceCommand(cmdText) {
    if (!cmdText) return;

    // Normalise transcript text (lowercase, remove punctuation, collapse whitespace)
    const text = cmdText.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    console.log('[Handsfree Command] Executing normalized command:', text);

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

  startBtn.addEventListener('click', startRecording);

  stopBtn.addEventListener('click', stopRecording);

  if (modeCommandBtn) modeCommandBtn.addEventListener('click', () => setActiveMode(Mode.COMMAND));
  if (modeDictationBtn) modeDictationBtn.addEventListener('click', () => setActiveMode(Mode.DICTATION));
  if (modeReadingBtn) modeReadingBtn.addEventListener('click', () => setActiveMode(Mode.READING));

  if (readPlayBtn) readPlayBtn.addEventListener('click', startReadingPage);
  if (readPauseBtn) readPauseBtn.addEventListener('click', pauseOrResumeReading);
  if (readStopBtn) readStopBtn.addEventListener('click', stopReadingPage);
  if (prevSecBtn) prevSecBtn.addEventListener('click', readPreviousSection);
  if (nextSecBtn) nextSecBtn.addEventListener('click', readNextSection);
  if (repeatSecBtn) repeatSecBtn.addEventListener('click', repeatCurrentSection);

  if (grantMicBtn) {
    grantMicBtn.addEventListener('click', openPermissionTab);
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
});



