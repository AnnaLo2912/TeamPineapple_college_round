const msg = document.getElementById('msg')
const retry = document.getElementById('retry')

async function requestCamera() {
  retry.style.display = 'none'
  msg.textContent = 'Requesting camera permission…'

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true })
    stream.getTracks().forEach(track => track.stop())

    chrome.runtime.sendMessage({ type: 'CAMERA_GRANTED' }, () => {
      void chrome.runtime.lastError
    })

    window.close()
  } catch (error) {
    console.error('Camera permission denied:', error)
    msg.textContent = 'Camera access was denied or unavailable. Click below to try again.'
    retry.style.display = 'inline-block'
  }
}

retry.addEventListener('click', () => {
  void requestCamera()
})

void requestCamera()
