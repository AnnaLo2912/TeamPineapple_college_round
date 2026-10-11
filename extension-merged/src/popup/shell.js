// Shell popup: hosts the head+hands panel and the voice panel side by side via
// iframes, with a tab switch and a tracking enable toggle at the top.

const HANDSFREE_PANEL = 'src/popup/popup.html'
const VOICE_PANEL = 'voice/popup.html'

const panelHandsfree = document.getElementById('panelHandsfree')
const panelVoice = document.getElementById('panelVoice')
const tabHandsfree = document.getElementById('tabHandsfree')
const tabVoice = document.getElementById('tabVoice')
const handsfreeToggle = document.getElementById('handsfreeToggle')

panelHandsfree.src = chrome.runtime.getURL(HANDSFREE_PANEL)
panelVoice.src = chrome.runtime.getURL(VOICE_PANEL)

function selectPanel(name) {
  const isHandsfree = name === 'handsfree'
  panelHandsfree.classList.toggle('active', isHandsfree)
  panelVoice.classList.toggle('active', !isHandsfree)
  tabHandsfree.classList.toggle('active', isHandsfree)
  tabVoice.classList.toggle('active', !isHandsfree)
  tabHandsfree.setAttribute('aria-selected', String(isHandsfree))
  tabVoice.setAttribute('aria-selected', String(!isHandsfree))
}

tabHandsfree.addEventListener('click', () => selectPanel('handsfree'))
tabVoice.addEventListener('click', () => selectPanel('voice'))

const btnBenchmark = document.getElementById('btnBenchmark')
if (btnBenchmark) {
  btnBenchmark.addEventListener('click', () => {
    fetch('http://localhost:5173/', { mode: 'no-cors' })
      .then(() => chrome.tabs.create({ url: 'http://localhost:5173/' }))
      .catch(() => chrome.tabs.create({ url: chrome.runtime.getURL('evaluation.html') }))
  })
}

function renderState(state) {
  if (!state) return
  if (typeof state.headhands === 'boolean') handsfreeToggle.checked = state.headhands
  // Voice enable toggle is deferred; its state is retrieved but not surfaced yet.
}

chrome.runtime.sendMessage({ type: 'GET_MODULE_STATE' }, (res) => {
  if (chrome.runtime.lastError) return
  renderState(res)
})

handsfreeToggle.addEventListener('change', () => {
  chrome.runtime.sendMessage(
    { type: 'SET_MODULE_STATE', headhands: handsfreeToggle.checked },
    (res) => {
      if (chrome.runtime.lastError) return
      renderState(res && res.state)
    }
  )
})

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'MODULE_STATE') renderState(message)
})
