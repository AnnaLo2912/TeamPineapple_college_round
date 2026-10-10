import fs from 'fs'
import path from 'path'
import os from 'os'
import { exec } from 'child_process'
import { speak, playEarcon } from './ttsEngine.js'

/**
 * System Screen Dictator
 * Identifies the currently active foreground window, running apps,
 * and desktop items (folders, apps, files) for accessibility and blind users.
 */

/**
 * Scans Windows desktop directories (User Desktop, OneDrive Desktop, and Public Desktop)
 */
export function getDesktopItems() {
  const candidateDirs = [
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'OneDrive', 'Desktop'),
    'C:\\Users\\Public\\Desktop'
  ]

  const folders = []
  const apps = []
  const files = []
  const seen = new Set()

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const name = entry.name
        if (!name || name.toLowerCase() === 'desktop.ini') continue

        const fullPath = path.join(dir, name)
        let cleanName = name

        if (entry.isDirectory()) {
          if (!seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase())
            folders.push({ name, cleanName, fullPath, isFolder: true })
          }
        } else if (name.toLowerCase().endsWith('.lnk')) {
          cleanName = name.replace(/\.lnk$/i, '').replace(/ - Copy$/i, '').trim()
          if (!seen.has(cleanName.toLowerCase())) {
            seen.add(cleanName.toLowerCase())
            apps.push({ name, cleanName, fullPath, isApp: true })
          }
        } else {
          cleanName = path.parse(name).name
          if (!seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase())
            files.push({ name, cleanName, fullPath, isFile: true })
          }
        }
      }
    } catch {}
  }

  return { folders, apps, files }
}

/**
 * Attempts to launch a desktop item (folder, shortcut, or file) by partial name match
 */
export function openDesktopItem(query) {
  if (!query) return false
  const lower = query.toLowerCase().trim()
  const { folders, apps, files } = getDesktopItems()
  const all = [...folders, ...apps, ...files]

  // Direct match or partial match
  const match = all.find(item =>
    item.cleanName.toLowerCase() === lower ||
    lower.includes(item.cleanName.toLowerCase()) ||
    item.cleanName.toLowerCase().includes(lower)
  )

  if (match) {
    playEarcon('success')
    const typeLabel = match.isFolder ? 'folder' : (match.isApp ? 'application' : 'file')
    speak(`Opening ${match.cleanName} ${typeLabel}`)
    console.log(`[Screen Dictator] Opening ${typeLabel}: "${match.cleanName}" (${match.fullPath})`)

    if (match.isFolder) {
      exec(`explorer.exe "${match.fullPath}"`)
    } else {
      exec(`start "" "${match.fullPath}"`)
    }
    return true
  }

  return false
}

/**
 * Gets active foreground window using Win32 API
 */
export function getActiveWindowInfo() {
  return new Promise((resolve) => {
    const psScript = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        using System.Text;
        public class WinInfo {
          [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
          [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder strText, int maxCount);
          [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

          public static string GetActive() {
            IntPtr handle = GetForegroundWindow();
            StringBuilder b = new StringBuilder(256);
            GetWindowText(handle, b, 256);
            uint pid;
            GetWindowThreadProcessId(handle, out pid);
            string procName = "";
            try { procName = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch {}
            return b.ToString() + "|" + procName;
          }
        }
"@
      [WinInfo]::GetActive()
    `

    exec(`powershell.exe -NoProfile -NonInteractive -Command "${psScript.replace(/\n/g, ' ')}"`, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve({ title: 'Desktop', processName: 'explorer' })
        return
      }

      const parts = stdout.trim().split('|')
      const title = parts[0]?.trim() || 'Desktop or System Window'
      const processName = parts[1]?.trim() || 'explorer'

      resolve({ title, processName })
    })
  })
}

/**
 * Retrieves all currently open application windows
 */
export async function getOpenWindowsList() {
  return new Promise((resolve) => {
    const psScript = `
      Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -ExpandProperty MainWindowTitle
    `
    exec(`powershell.exe -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve([])
        return
      }
      const list = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      resolve(list)
    })
  })
}

/**
 * Speaks out active window and its details
 */
export async function announceActiveWindow() {
  playEarcon('listen')
  const info = await getActiveWindowInfo()
  const announcement = `Active window is ${info.title}`
  console.log(`[Screen Dictator] ${announcement} (Process: ${info.processName})`)
  await speak(announcement)
  return info
}

/**
 * Speaks list of open application windows
 */
export async function announceOpenWindows() {
  playEarcon('listen')
  const windows = await getOpenWindowsList()
  if (!windows.length) {
    const msg = 'No active application windows are currently open.'
    console.log(`[Screen Dictator] ${msg}`)
    await speak(msg)
    return
  }

  const topWindows = windows.slice(0, 5)
  const text = `You have ${windows.length} open windows: ${topWindows.join(', ')}`
  console.log(`[Screen Dictator] ${text}`)
  await speak(text)
}

/**
 * Main USP: Comprehensive Screen & Desktop Dictator for System Boot
 * Dictates all open apps on screen, desktop folders, and files,
 * then guides the blind user on what commands they can speak.
 */
export async function dictateStartupScreen() {
  playEarcon('listen')

  const [activeInfo, openWindows] = await Promise.all([
    getActiveWindowInfo(),
    getOpenWindowsList()
  ])
  const { folders, apps, files } = getDesktopItems()

  console.log('\n🎙️  [Screen Dictator Overview]')
  console.log(`• Active Window: ${activeInfo.title} (${activeInfo.processName})`)
  console.log(`• Open Windows (${openWindows.length}): ${openWindows.slice(0, 4).join(', ') || 'None'}`)
  console.log(`• Desktop Folders (${folders.length}): ${folders.map(f => f.cleanName).join(', ') || 'None'}`)
  console.log(`• Desktop Applications (${apps.length}): ${apps.map(a => a.cleanName).join(', ') || 'None'}`)

  // Build clean, natural speech announcement
  let speech = 'Handsfree System Assistant is ready. '

  if (openWindows.length > 0) {
    const cleanAppNames = openWindows
      .slice(0, 4)
      .map(w => w.split('-')[0].split('—')[0].trim())
      .filter((v, i, a) => a.indexOf(v) === i)
    speech += `On your screen right now, open applications are: ${cleanAppNames.join(', ')}. `
  } else {
    speech += 'You are on the desktop. '
  }

  const folderNames = folders.slice(0, 3).map(f => f.cleanName)
  const appNames = apps.slice(0, 4).map(a => a.cleanName)

  if (folderNames.length > 0) {
    speech += `On your desktop, folders available: ${folderNames.join(', ')}. `
  }

  if (appNames.length > 0) {
    speech += `Desktop applications: ${appNames.join(', ')}. `
  }

  speech += 'Tell me what to open. You can say: Open Google, Open File Explorer, or open any folder.'

  console.log(`🗣️  [Voice Assistant Announcement]:\n"${speech}"\n`)
  await speak(speech)
  return speech
}
