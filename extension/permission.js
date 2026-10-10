document.addEventListener('DOMContentLoaded', () => {
  const requestBtn = document.getElementById('requestBtn');
  const statusMsg = document.getElementById('statusMsg');

  async function requestMicAccess() {
    try {
      statusMsg.className = 'status-msg status-info';
      statusMsg.textContent = 'Requesting permission... Please click "Allow" in your browser prompt above.';

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Immediately stop track so hardware mic turns off
      stream.getTracks().forEach(t => t.stop());

      statusMsg.className = 'status-msg status-success';
      statusMsg.textContent = 'Microphone access granted successfully! Closing setup window...';
      requestBtn.disabled = true;

      setTimeout(() => {
        window.close();
      }, 1500);

    } catch (err) {
      console.error('[Handsfree Setup] Permission error:', err);
      statusMsg.className = 'status-msg status-error';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        statusMsg.textContent = 'Permission denied. Please click the lock icon in the Chrome address bar to set Microphone to "Allow".';
      } else {
        statusMsg.textContent = `Error: ${err.message || 'Failed to acquire microphone.'}`;
      }
    }
  }

  requestBtn.addEventListener('click', requestMicAccess);

  // Auto-trigger on page load
  requestMicAccess();
});
