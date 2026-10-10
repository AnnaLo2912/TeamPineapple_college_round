import readline from 'readline'
import { spawn, execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { executeCommand } from './systemActions.js'
import { announceActiveWindow, announceOpenWindows, dictateStartupScreen } from './screenDictator.js'
import { dictateFolder } from './fileNavigator.js'
import { speak, playEarcon, isTtsSpeaking } from './ttsEngine.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let micProcess = null

export function cleanupExistingMicProcesses() {
  try {
    const cmd = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*listenMic.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    execSync(`powershell.exe -NoProfile -Command "${cmd}"`, { stdio: 'ignore' })
  } catch {}
}

/**
 * Voice & Command Dispatcher for Tier 1 System Software
 * Routes user speech and commands to the appropriate OS action or Screen Dictator.
 */

export async function processVoiceInput(input) {
  if (!input || typeof input !== 'string') return
  const text = input.trim()
  if (!text) return

  // Prevent self-triggering: Ignore audio picked up from laptop speakers while assistant is speaking
  if (isTtsSpeaking()) {
    return
  }

  console.log(`\n🎤 [Tier 1 Voice Command Received]: "${text}"`)

  // Check Screen Dictator commands (Full Screen & Desktop Dictation)
  const lower = text.toLowerCase()
  if (
    lower.includes('screen') ||
    lower.includes('desktop') ||
    lower.includes('what is on') ||
    lower.includes("what's on") ||
    lower.includes('read screen') ||
    lower.includes('where am i') ||
    lower.includes('all apps')
  ) {
    await dictateStartupScreen()
    return
  }

  if (
    lower.includes('active window') ||
    lower.includes('current window')
  ) {
    await announceActiveWindow()
    return
  }

  if (
    lower.includes('list windows') ||
    lower.includes('open windows') ||
    lower.includes('what windows are open')
  ) {
    await announceOpenWindows()
    return
  }

  // Check Folder & File Dictation ("what is in downloads", "read documents", "what files are on desktop")
  if (lower.includes('download') && (lower.includes('what') || lower.includes('list') || lower.includes('read') || lower.includes('files'))) {
    await dictateFolder('downloads')
    return
  }

  if (lower.includes('document') && (lower.includes('what') || lower.includes('list') || lower.includes('read') || lower.includes('files'))) {
    await dictateFolder('documents')
    return
  }

  if (lower.includes('desktop') && (lower.includes('what files') || lower.includes('list files') || lower.includes('read files'))) {
    await dictateFolder('desktop')
    return
  }

  if (lower.includes('project') && (lower.includes('what') || lower.includes('list') || lower.includes('read') || lower.includes('files'))) {
    await dictateFolder('project')
    return
  }

  // Check System Actions (Open Google, Open File Explorer, Open <Filename>, etc.)
  const actionExecuted = await executeCommand(text)
  if (actionExecuted) {
    return
  }

  // Help command
  if (lower.includes('help') || lower.includes('what can you do')) {
    playEarcon('listen')
    const helpMsg = 'Available commands: Open File Explorer, Open Google, Open Notepad, What is on screen, List windows, Volume up, Volume down, Close window, and Minimize window.'
    console.log(`ℹ️ [Help]: ${helpMsg}`)
    await speak(helpMsg)
    return
  }

  // Unrecognized command
  playEarcon('error')
  console.log(`⚠️ Unrecognized command: "${text}". Say "help" for a list of commands.`)
}

/**
 * Starts native background microphone listener via Windows Speech Recognition
 */
export function startMicrophoneListener() {
  const psScriptPath = path.join(__dirname, 'listenMic.ps1')

  micProcess = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', psScriptPath
  ], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  micProcess.stdout.on('data', (data) => {
    const lines = data.toString().split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === 'LISTENER_READY') {
        console.log('🎙️  [Live Mic] Windows Microphone listening actively in background! You can speak commands from any window/desktop.')
      } else if (trimmed.startsWith('RECOGNIZED:')) {
        const recognizedText = trimmed.replace('RECOGNIZED:', '').trim()
        if (recognizedText) {
          void processVoiceInput(recognizedText)
        }
      } else if (trimmed.startsWith('LISTENER_ERROR:')) {
        console.warn(`[Live Mic] Audio Note: ${trimmed}`)
      }
    }
  })

  micProcess.stderr.on('data', (data) => {
    const errText = data.toString().trim()
    if (errText) {
      console.warn(`[Live Mic Stderr]: ${errText}`)
    }
  })

  micProcess.on('error', (err) => {
    console.error(`[Live Mic Spawn Error]:`, err)
  })

  micProcess.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.warn(`[Live Mic] Listener process exited (code ${code}). Restarting in 2s...`)
      setTimeout(startMicrophoneListener, 2000)
    }
  })

  const killMic = () => {
    if (micProcess && micProcess.pid) {
      try {
        execSync(`taskkill /pid ${micProcess.pid} /t /f`, { stdio: 'ignore' })
      } catch {}
      try { micProcess.kill() } catch {}
      micProcess = null
    }
  }

  process.on('exit', killMic)
  process.on('SIGINT', () => { killMic(); process.exit(0) })
  process.on('SIGTERM', () => { killMic(); process.exit(0) })
}

/**
 * Starts interactive CLI listener so the user can test all system commands immediately
 */
export function startInteractiveConsole() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  console.log('\n======================================================')
  console.log('🎙️  HANDSFREE TIER 1 SYSTEM SOFTWARE CONSOLE')
  console.log('• You can SPEAK commands out loud from your desktop')
  console.log('• Or TYPE commands below into this terminal:')
  console.log('Examples:')
  console.log('  • "open file explorer"')
  console.log('  • "open google"')
  console.log('  • "what is on screen"')
  console.log('  • "open notepad"')
  console.log('  • "volume up"')
  console.log('  • "help"')
  console.log('======================================================\n')

  const promptUser = () => {
    rl.question('Handsfree Command > ', async (answer) => {
      if (answer.toLowerCase() === 'exit' || answer.toLowerCase() === 'quit') {
        console.log('Stopping Handsfree System Software.')
        if (micProcess) {
          try { micProcess.kill() } catch {}
        }
        process.exit(0)
      }
      await processVoiceInput(answer)
      promptUser()
    })
  }

  promptUser()
}
