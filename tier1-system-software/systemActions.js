import { exec } from 'child_process'
import { speak, playEarcon } from './ttsEngine.js'
import { openDesktopItem } from './screenDictator.js'
import { findAndOpenFile } from './fileNavigator.js'

/**
 * System Actions Engine
 * Executes native Windows applications, window controls, and OS utilities.
 */

export async function executeCommand(rawCommand) {
  if (!rawCommand || typeof rawCommand !== 'string') return false
  const cmd = rawCommand.toLowerCase().trim()

  console.log(`[Tier 1 System Action] Executing: "${cmd}"`)

  // Click Action (Trigger mouse click at current cursor position)
  if (cmd === 'click' || cmd === 'click it' || cmd === 'click link' || cmd === 'tap' || cmd === 'press') {
    playEarcon('success')
    const ps = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class M { [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint c, uint e); public static void C() { mouse_event(2, 0, 0, 0, 0); mouse_event(4, 0, 0, 0, 0); } }'; [M]::C()`
    exec(`powershell -NoProfile -Command "${ps}"`)
    return true
  }

  // 1. App Launchers
  if (
    cmd.includes('file explorer') ||
    cmd.includes('open files') ||
    cmd.includes('explorer') ||
    cmd === 'files'
  ) {
    playEarcon('success')
    speak('Opening File Explorer')
    exec('explorer.exe')
    return true
  }

  if (
    cmd.includes('google') ||
    cmd.includes('browser') ||
    cmd.includes('chrome') ||
    cmd.includes('internet')
  ) {
    playEarcon('success')
    speak('Opening Google Search in browser')
    exec('start "" "https://www.google.com"')
    return true
  }

  if (
    cmd.includes('notepad') ||
    cmd.includes('text editor') ||
    cmd.includes('notes')
  ) {
    playEarcon('success')
    speak('Opening Notepad')
    exec('notepad.exe')
    return true
  }

  if (cmd.includes('calculator') || cmd === 'calc') {
    playEarcon('success')
    speak('Opening Calculator')
    exec('calc.exe')
    return true
  }

  if (cmd.includes('settings') || cmd.includes('windows settings')) {
    playEarcon('success')
    speak('Opening Windows Settings')
    exec('start ms-settings:')
    return true
  }

  if (cmd.includes('task manager')) {
    playEarcon('success')
    speak('Opening Task Manager')
    exec('taskmgr.exe')
    return true
  }

  // 2. Window Controls
  if (cmd.includes('minimize window') || cmd === 'minimize') {
    playEarcon('success')
    speak('Minimizing active window')
    const ps = `
      $w = (Get-Process | Where-Object { $_.MainWindowHandle -eq (Add-Type '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();' -Name U -PassThru)::GetForegroundWindow() });
      if ($w) { (New-Object -ComObject Shell.Application).MinimizeAll() }
    `
    exec(`powershell -NoProfile -Command "${ps}"`)
    return true
  }

  if (cmd.includes('close window') || cmd.includes('exit window')) {
    playEarcon('success')
    speak('Closing active window')
    const ps = `
      Add-Type -AssemblyName System.Windows.Forms;
      [System.Windows.Forms.SendKeys]::SendWait("%{F4}")
    `
    exec(`powershell -NoProfile -Command "${ps}"`)
    return true
  }

  if (cmd.includes('switch window') || cmd.includes('next window')) {
    playEarcon('success')
    speak('Switching window')
    const ps = `
      Add-Type -AssemblyName System.Windows.Forms;
      [System.Windows.Forms.SendKeys]::SendWait("%{TAB}")
    `
    exec(`powershell -NoProfile -Command "${ps}"`)
    return true
  }

  // 3. Audio & Volume Controls
  if (cmd.includes('volume up') || cmd.includes('increase volume')) {
    playEarcon('success')
    speak('Volume up')
    const ps = `
      $obj = New-Object -ComObject WScript.Shell;
      for ($i=0; $i -lt 5; $i++) { $obj.SendKeys([char]175) }
    `
    exec(`powershell -NoProfile -Command "${ps}"`)
    return true
  }

  if (cmd.includes('volume down') || cmd.includes('decrease volume')) {
    playEarcon('success')
    speak('Volume down')
    const ps = `
      $obj = New-Object -ComObject WScript.Shell;
      for ($i=0; $i -lt 5; $i++) { $obj.SendKeys([char]174) }
    `
    exec(`powershell -NoProfile -Command "${ps}"`)
    return true
  }

  if (cmd.includes('mute') || cmd.includes('unmute')) {
    playEarcon('success')
    speak('Toggling mute')
    const ps = `(New-Object -ComObject WScript.Shell).SendKeys([char]173)`
    exec(`powershell -NoProfile -Command "${ps}"`)
    return true
  }

  // 4. Scrolling Controls
  if (cmd.includes('scroll down') || cmd.includes('page down')) {
    playEarcon('listen')
    const ps = `
      Add-Type -AssemblyName System.Windows.Forms;
      [System.Windows.Forms.SendKeys]::SendWait("{PGDN}")
    `
    exec(`powershell -NoProfile -Command "${ps}"`)
    return true
  }

  if (cmd.includes('scroll up') || cmd.includes('page up')) {
    playEarcon('listen')
    const ps = `
      Add-Type -AssemblyName System.Windows.Forms;
      [System.Windows.Forms.SendKeys]::SendWait("{PGUP}")
    `
    exec(`powershell -NoProfile -Command "${ps}"`)
    return true
  }

  // 5. Dynamic Desktop Folders & Apps Launcher ("open tools", "open brave", "open vs code", etc.)
  const cleanTarget = cmd.replace(/^open\s+/, '').replace(/\s+folder$/, '').trim()
  if (cleanTarget) {
    const opened = openDesktopItem(cleanTarget)
    if (opened) return true
  }

  // 6. File Navigator: Search & Open Files/Folders in Downloads, Documents, Desktop, Project
  const fileOpened = await findAndOpenFile(cmd)
  if (fileOpened) {
    return true
  }

  return false
}
