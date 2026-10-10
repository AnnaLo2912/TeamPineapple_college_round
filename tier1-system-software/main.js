import { speak, playEarcon } from './ttsEngine.js'
import { isStartupEnabled, enableAutoStartup, disableAutoStartup } from './startupManager.js'
import { startInteractiveConsole, startMicrophoneListener } from './voiceListener.js'

async function init() {
  const args = process.argv.slice(2)

  if (args.includes('--enable-startup')) {
    enableAutoStartup()
    process.exit(0)
  }

  if (args.includes('--disable-startup')) {
    disableAutoStartup()
    process.exit(0)
  }

  console.clear()
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║       HANDSFREE TIER 1 — NATIVE SYSTEM SOFTWARE             ║')
  console.log('║       Accessibility, OS Control & Screen Dictation           ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')

  const autoBoot = isStartupEnabled()
  console.log(`\n⚙️  Windows Auto-Boot on System Startup: [${autoBoot ? 'ACTIVE ✅' : 'DISABLED ⚪'}]`)
  if (!autoBoot) {
    console.log('   (Run with `npm run enable-startup` to start automatically on Windows boot)')
  }

  // Play startup sound and speak greeting
  playEarcon('startup')
  await speak('Handsfree System Assistant is active. Listening for commands.')

  // Start background microphone listener & interactive console
  startMicrophoneListener()
  startInteractiveConsole()

  // Keep-alive timer so the assistant never terminates unexpectedly
  setInterval(() => {}, 1000 * 60 * 60)
}

init().catch(console.error)
