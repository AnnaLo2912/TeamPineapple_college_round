document.addEventListener('DOMContentLoaded', () => {
  const requestBtn = document.getElementById('requestBtn');
  const statusMsg = document.getElementById('statusMsg');

  async function requestPermissions() {
    try {
      statusMsg.className = 'status-msg status-info';
      statusMsg.textContent = 'Requesting Camera & Microphone access... Click "Allow" in the browser prompt above.';

      let camGranted = false;
      let micGranted = false;

      // 1. Try requesting both camera and microphone together
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        stream.getTracks().forEach(t => t.stop());
        camGranted = true;
        micGranted = true;
      } catch (combinedErr) {
        console.warn('[Handsfree Setup] Combined request failed, trying individually:', combinedErr);

        // Try camera individually
        try {
          const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
          camStream.getTracks().forEach(t => t.stop());
          camGranted = true;
        } catch (camErr) {
          console.warn('[Handsfree Setup] Camera individual request error:', camErr);
        }

        // Try microphone individually
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          micStream.getTracks().forEach(t => t.stop());
          micGranted = true;
        } catch (micErr) {
          console.warn('[Handsfree Setup] Mic individual request error:', micErr);
        }
      }

      if (camGranted || micGranted) {
        statusMsg.className = 'status-msg status-success';
        const grantedLabels = [camGranted && 'Camera', micGranted && 'Microphone'].filter(Boolean).join(' & ');
        statusMsg.textContent = `${grantedLabels} access granted successfully! Starting tracking…`;
        requestBtn.disabled = true;

        // Notify background that camera is granted so tracking starts immediately
        if (camGranted) {
          chrome.runtime.sendMessage({ type: 'CAMERA_GRANTED' }, () => {
            void chrome.runtime.lastError;
          });
        }

        setTimeout(() => {
          window.close();
        }, 1500);
      } else {
        throw new Error('Neither camera nor microphone could be accessed.');
      }

    } catch (err) {
      console.error('[Handsfree Setup] Permission error:', err);
      statusMsg.className = 'status-msg status-error';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        statusMsg.textContent = 'Permission was dismissed or blocked. Click the tune/lock icon in the Chrome address bar to set Camera and Microphone to "Allow", then click Try Again.';
      } else {
        statusMsg.textContent = `Error: ${err.message || 'Failed to acquire camera or microphone.'}`;
      }
    }
  }

  requestBtn.addEventListener('click', requestPermissions);

  // Auto-trigger on page load
  requestPermissions();
});
