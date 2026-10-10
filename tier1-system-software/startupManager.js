import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Windows Auto-Boot Manager
 * Registers the Tier 1 System Software to automatically boot on system startup.
 */

function getStartupFolderPath() {
  const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || 'C:\\', 'AppData', 'Roaming')
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
}

function getVbsLauncherPath() {
  return path.join(getStartupFolderPath(), 'HandsfreeSystemAssistant.vbs')
}

export function isStartupEnabled() {
  const vbsPath = getVbsLauncherPath()
  return fs.existsSync(vbsPath)
}

export function enableAutoStartup() {
  const startupFolder = getStartupFolderPath()
  const vbsPath = getVbsLauncherPath()
  const mainJsPath = path.resolve(__dirname, 'main.js')
  const nodeExe = process.execPath

  if (!fs.existsSync(startupFolder)) {
    fs.mkdirSync(startupFolder, { recursive: true })
  }

  // Create a silent VBS launcher so it runs in the background on boot without popping up a black console
  const vbsContent = [
    `Set WshShell = CreateObject("WScript.Shell")`,
    `WshShell.CurrentDirectory = "${__dirname.replace(/\\/g, '\\\\')}"`,
    `WshShell.Run """${nodeExe.replace(/\\/g, '\\\\')}"" ""${mainJsPath.replace(/\\/g, '\\\\')}""", 0, False`,
    `Set WshShell = Nothing`,
  ].join('\r\n')

  fs.writeFileSync(vbsPath, vbsContent, 'utf-8')
  console.log(`[Startup Manager] ✅ Auto-boot enabled!`)
  console.log(`[Startup Manager] Registered in Windows Startup: ${vbsPath}`)
  return true
}

export function disableAutoStartup() {
  const vbsPath = getVbsLauncherPath()
  if (fs.existsSync(vbsPath)) {
    fs.unlinkSync(vbsPath)
    console.log(`[Startup Manager] 🛑 Auto-boot disabled. Removed from Startup folder.`)
    return true
  }
  console.log(`[Startup Manager] Auto-boot was not active.`)
  return false
}
