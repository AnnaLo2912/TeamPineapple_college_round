import readline from 'readline'
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { executeCommand } from './systemActions.js'
import { announceActiveWindow, announceOpenWindows } from './screenDictator.js'
import { speak, playEarcon } from './ttsEngine.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let micProcess = null

/**
 * Voice & Command Dispatcher for Tier 1 System Software
 * Routes user speech and commands to the appropriate OS action or Screen Dictator.
 */

export async function processVoiceInput(input) {
  if (!input || typeof input !== 'string') return
  const text = input.trim()
  if (!text) return

  console.log(`\n🎤 [Tier 1 Voice Command Received]: "${text}"`)

  // Check Screen Dictator commands
  const lower = text.toLowerCase()
  if (
    lower.includes('what is on screen') ||
    lower.includes("what's on screen") ||
    lower.includes('read screen') ||
    lower.includes('active window') ||
    lower.includes('desktop') ||
    lower.includes('index topped') ||
    lower.includes('next stop') ||
    lower.includes('where am i') ||
    lower === 'screen'
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

  // Check System Actions (Open Google, Open File Explorer, etc.)
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

  micProcess = spawn('powershell', [
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
        console.warn(`[Live Mic] Note: ${trimmed}`)
      }
    }
  })

  process.on('exit', () => {
    if (micProcess) {
      try { micProcess.kill() } catch {}
    }
  })
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
