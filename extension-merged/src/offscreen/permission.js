const msg = document.getElementById('msg')
const retry = document.getElementById('retry')

async function requestCamera() {
  retry.style.display = 'none'
  msg.textContent = 'Requesting camera & microphone permission…'

  try {
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ video: true })
    }
    stream.getTracks().forEach((track) => track.stop())

    chrome.runtime.sendMessage({ type: 'CAMERA_GRANTED' }, () => {
      void chrome.runtime.lastError
    })

    window.close()
  } catch (error) {
    // If combined audio+video failed, try video only as fallback
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stream.getTracks().forEach((track) => track.stop())
      chrome.runtime.sendMessage({ type: 'CAMERA_GRANTED' }, () => void chrome.runtime.lastError)
      window.close()
      return
    } catch (_) {}

    console.error('Camera/Microphone permission denied:', error)
    msg.textContent = 'Camera & Microphone access was denied or unavailable. Click below to try again.'
    retry.style.display = 'inline-block'
  }
}

retry.addEventListener('click', () => {
  void requestCamera()
})

void requestCamera()
