chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set({
      handsfree_config: {
        mode: 'face',
        sensitivity: 1.5,
        deadZone: 0.02,
        smoothing: 0.15,
        showWebcamPreview: false,
      }
    })
    
    chrome.tabs.create({
      url: 'https://github.com/geoffreygao1/Hands-Free-Controller',
      active: true
    })
  }
})

chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { 
        type: command === 'toggle-tracking' ? 'TOGGLE_TRACKING' : 'RECENTER' 
      })
    }
  })
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_VERSION') {
    sendResponse({ version: chrome.runtime.getManifest().version })
    return true
  }
  
  if (message.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage()
    return true
  }
  
  return false
})

export {}