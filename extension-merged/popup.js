/**
 * Handsfree Chrome Extension - Popup Controller
 *
 * Thin view/controller. Microphone capture, VAD, STT, and TTS all run in the
 * offscreen document; command parsing and tab actions run in the service
 * worker. This popup only sends intents and renders state.
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- DOM Elements ---------------------------------------------------------
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const copyBtn = document.getElementById('copyBtn');

  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const messageBox = document.getElementById('messageBox');
  const messageText = document.getElementById('messageText');

  const transcriptText = document.getElementById('transcriptText');
  const visualizer = document.getElementById('visualizer');
  const backendIndicator = document.getElementById('backendIndicator');
  const grantMicBtn = document.getElementById('grantMicBtn');
  const toggleNumbersBtn = document.getElementById('toggleNumbersBtn');
  const toggleNumbersText = document.getElementById('toggleNumbersText');

  const modeCommandBtn = document.getElementById('modeCommand');
  const modeDictationBtn = document.getElementById('modeDictation');
  const modeReadingBtn = document.getElementById('modeReading');
  const modeBlindBtn = document.getElementById('modeBlind');
  const blindModeToggle = document.getElementById('blindModeToggle');
  const alwaysListeningToggle = document.getElementById('alwaysListeningToggle');

  const readingProgress = document.getElementById('readingProgress');
  const readPlayBtn = document.getElementById('readPlayBtn');
  const readPauseBtn = document.getElementById('readPauseBtn');
  const readStopBtn = document.getElementById('readStopBtn');
  const prevSecBtn = document.getElementById('prevSecBtn');
  const nextSecBtn = document.getElementById('nextSecBtn');
  const repeatSecBtn = document.getElementById('repeatSecBtn');

  // --- Messaging ------------------------------------------------------------

  function sendBG(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          void chrome.runtime.lastError;
          resolve(response);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function sendCommand(text) {
    return sendBG({ type: 'VOICE_COMMAND', text });
  }

  // --- Backend health -------------------------------------------------------

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
      } catch {
        // Fallback to next port
      }
    }
    return backendBaseUrl;
  }

  async function checkBackendHealth() {
    try {
      await resolveBackendUrl();
      const response = await fetch(`${backendBaseUrl}/api/health`, { method: 'GET' });
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
    } catch {
      backendIndicator.classList.add('backend-offline');
      backendIndicator.classList.remove('backend-online');
      backendIndicator.title = `Backend offline (${backendBaseUrl})`;
      return false;
    }
  }

  // --- State rendering ------------------------------------------------------

  let voiceState = {
    listening: false,
    always: false,
    engineState: 'stopped',
    mode: 'command',
    readingActive: false,
    readingIndex: -1,
    readingTotal: 0,
    numbersActive: false,
    transcript: '',
    message: '',
  };

  function updateNumbersBtnUI(active, count) {
    if (!toggleNumbersBtn) return;
    if (active) {
      toggleNumbersBtn.classList.add('active');
      if (toggleNumbersText) toggleNumbersText.textContent = `Hide Numbered Links${count ? ` (${count})` : ''}`;
    } else {
      toggleNumbersBtn.classList.remove('active');
      if (toggleNumbersText) toggleNumbersText.textContent = 'Show Numbered Links';
    }
  }

  function renderMessage(msg, kind = 'info') {
    messageBox.className = `message-box message-${kind}`;
    if (msg) messageText.textContent = msg;
  }

  function applyVoiceState(partial) {
    voiceState = { ...voiceState, ...partial };
    const s = voiceState;

    if (alwaysListeningToggle) alwaysListeningToggle.checked = !!s.always;

    if (s.listening) {
      const starting = s.engineState === 'starting';
      statusBadge.className = 'status-badge status-recording';
      statusText.textContent = starting ? 'Starting...' : 'Listening';
      visualizer.classList.add('recording');
      startBtn.disabled = true;
      stopBtn.disabled = false;
    } else {
      statusBadge.className = 'status-badge status-idle';
      statusText.textContent = s.engineState === 'error' ? 'Error' : 'Idle';
      visualizer.classList.remove('recording');
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }

    const modeButtons = [
      ['command', modeCommandBtn],
      ['dictation', modeDictationBtn],
      ['reading', modeReadingBtn],
      ['blind', modeBlindBtn],
    ];
    modeButtons.forEach(([mode, btn]) => {
      if (!btn) return;
      const on = s.mode === mode;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (blindModeToggle) blindModeToggle.checked = s.mode === 'blind';

    if (s.readingActive) {
      readingProgress.textContent = `Sec ${s.readingIndex + 1}/${s.readingTotal}`;
      if (readPauseBtn) readPauseBtn.disabled = false;
      if (readStopBtn) readStopBtn.disabled = false;
    } else {
      readingProgress.textContent = 'Stopped';
      if (readPauseBtn) readPauseBtn.disabled = true;
      if (readStopBtn) readStopBtn.disabled = true;
    }

    updateNumbersBtnUI(!!s.numbersActive, 0);

    if (s.transcript) {
      transcriptText.textContent = s.transcript;
      transcriptText.classList.remove('placeholder-text');
    }

    if (grantMicBtn) {
      const showGrant = !s.listening && s.engineState === 'error';
      grantMicBtn.classList.toggle('hidden', !showGrant);
    }

    if (s.message) {
      const lower = s.message.toLowerCase();
      const kind = lower.includes('error') || lower.includes('could not') ? 'error' : 'info';
      renderMessage(s.message, kind);
    } else if (s.engineState === 'error' && !s.listening) {
      renderMessage('Microphone error — check permissions and try again.', 'error');
    }
  }

  // --- Event listeners ------------------------------------------------------

  startBtn.addEventListener('click', () => {
    applyVoiceState({ listening: true, engineState: 'starting' });
    renderMessage('Starting voice engine...', 'info');
    sendBG({ type: 'VOICE_START_LISTENING' });
  });

  stopBtn.addEventListener('click', () => {
    sendBG({ type: 'VOICE_STOP_LISTENING' });
  });

  if (modeCommandBtn) modeCommandBtn.addEventListener('click', () => sendBG({ type: 'VOICE_MODE_SET', mode: 'command' }));
  if (modeDictationBtn) modeDictationBtn.addEventListener('click', () => sendBG({ type: 'VOICE_MODE_SET', mode: 'dictation' }));
  if (modeReadingBtn) modeReadingBtn.addEventListener('click', () => sendBG({ type: 'VOICE_MODE_SET', mode: 'reading' }));
  if (modeBlindBtn) modeBlindBtn.addEventListener('click', () => sendCommand('blind mode'));

  if (blindModeToggle) {
    blindModeToggle.addEventListener('change', (e) => {
      sendCommand(e.target.checked ? 'blind mode' : 'disable blind mode');
    });
  }

  if (alwaysListeningToggle) {
    alwaysListeningToggle.addEventListener('change', (e) => {
      sendBG({ type: 'VOICE_SET_ALWAYS', always: e.target.checked });
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      sendCommand(blindModeToggle?.checked ? 'disable blind mode' : 'blind mode');
    }
  });

  if (readPlayBtn) readPlayBtn.addEventListener('click', () => sendBG({ type: 'VOICE_READ_START' }));
  if (readPauseBtn) readPauseBtn.addEventListener('click', () => sendBG({ type: 'VOICE_READ_PAUSE_RESUME' }));
  if (readStopBtn) readStopBtn.addEventListener('click', () => sendBG({ type: 'VOICE_READ_STOP' }));
  if (prevSecBtn) prevSecBtn.addEventListener('click', () => sendBG({ type: 'VOICE_READ_PREV' }));
  if (nextSecBtn) nextSecBtn.addEventListener('click', () => sendBG({ type: 'VOICE_READ_NEXT' }));
  if (repeatSecBtn) repeatSecBtn.addEventListener('click', () => sendBG({ type: 'VOICE_READ_REPEAT' }));

  if (toggleNumbersBtn) {
    toggleNumbersBtn.addEventListener('click', () => {
      sendCommand(voiceState.numbersActive ? 'hide numbered links' : 'show numbered links');
    });
  }

  if (grantMicBtn) {
    grantMicBtn.addEventListener('click', () => {
      if (chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url: chrome.runtime.getURL('voice/permission.html') });
    });
  }

  const openBenchmarkBtn = document.getElementById('openBenchmarkBtn');
  if (openBenchmarkBtn) {
    openBenchmarkBtn.addEventListener('click', () => {
      if (chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: 'http://localhost:5173' });
      } else {
        window.open('http://localhost:5173', '_blank');
      }
    });
  }

  if (copyBtn) {
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
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    if (message.type === 'VOICE_STATE') {
      applyVoiceState(message);
    } else if (message.type === 'VOICE_TRANSCRIPT') {
      transcriptText.textContent = message.transcript || '';
      transcriptText.classList.remove('placeholder-text');
    }
  });

  // --- Initial setup --------------------------------------------------------

  applyVoiceState(voiceState);
  renderMessage('Click "Start Listening" to activate voice capture.', 'info');
  checkBackendHealth();

  sendBG({ type: 'GET_VOICE_STATE' }).then((state) => {
    if (state) applyVoiceState(state);
  });
  sendBG({ type: 'VOICE_SYNC_NUMBERS' });
});
