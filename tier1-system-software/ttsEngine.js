import { exec, spawn } from 'child_process'

/**
 * Windows Native Text-to-Speech & Earcon Audio Cue Engine
 * Works 100% offline using built-in Windows SAPI / System.Speech
 * Requires zero external npm packages or drivers.
 */

let activeTtsProcess = null
let isSpeaking = false

export function isTtsSpeaking() {
  return isSpeaking
}

export function speak(text, interrupt = true) {
  if (!text || typeof text !== 'string') return Promise.resolve()

  const sanitized = text.replace(/["`$]/g, ' ')

  if (interrupt && activeTtsProcess) {
    try {
      activeTtsProcess.kill()
    } catch {}
    activeTtsProcess = null
  }

  isSpeaking = true

  return new Promise((resolve) => {
    // Escape single quotes for PowerShell
    const psText = sanitized.replace(/'/g, "''")
    const psCommand = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = 1; $s.Speak('${psText}')`

    activeTtsProcess = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCommand], {
      windowsHide: true,
      stdio: 'ignore'
    })

    const onDone = () => {
      activeTtsProcess = null
      // 500ms safety buffer so laptop mic doesn't pick up trailing speaker sound
      setTimeout(() => {
        isSpeaking = false
        resolve()
      }, 500)
    }

    activeTtsProcess.on('close', onDone)
    activeTtsProcess.on('error', onDone)
  })
}

/**
 * Plays an earcon chime indicating state changes (startup, recognition, completion, error)
 */
export function playEarcon(type = 'chime') {
  let psCommand = ''
  switch (type) {
    case 'startup':
      // Ascending major chord
      psCommand = '[console]::beep(523, 100); [console]::beep(659, 100); [console]::beep(784, 150)'
      break
    case 'listen':
      // Short friendly pip
      psCommand = '[console]::beep(880, 80)'
      break
    case 'success':
      // Two-tone affirmation
      psCommand = '[console]::beep(587, 90); [console]::beep(880, 140)'
      break
    case 'error':
      // Low descending tone
      psCommand = '[console]::beep(350, 160); [console]::beep(260, 200)'
      break
    default:
      psCommand = '[System.Media.SystemSounds]::Asterisk.Play()'
  }

  exec(`powershell -NoProfile -NonInteractive -Command "${psCommand}"`, { windowsHide: true })
}
