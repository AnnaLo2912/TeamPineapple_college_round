import { exec } from 'child_process'
import { speak, playEarcon } from './ttsEngine.js'

/**
 * System Screen Dictator
 * Identifies the currently active foreground window and UI controls for blind users.
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

    exec(`powershell -NoProfile -NonInteractive -Command "${psScript.replace(/\n/g, ' ')}"`, (err, stdout) => {
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

export async function announceActiveWindow() {
  playEarcon('listen')
  const info = await getActiveWindowInfo()
  const announcement = `Active window is ${info.title}`
  console.log(`[Screen Dictator] ${announcement} (Process: ${info.processName})`)
  await speak(announcement)
  return info
}

export async function getOpenWindowsList() {
  return new Promise((resolve) => {
    const psScript = `
      Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -ExpandProperty MainWindowTitle
    `
    exec(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve([])
        return
      }
      const list = stdout.split('\n').map(l => l.trim()).filter(Boolean)
      resolve(list)
    })
  })
}

export async function announceOpenWindows() {
  playEarcon('listen')
  const windows = await getOpenWindowsList()
  if (!windows.length) {
    speak('No active user application windows found.')
    return
  }

  const topWindows = windows.slice(0, 5)
  const text = `You have ${windows.length} open windows. Top windows are: ${topWindows.join(', ')}`
  console.log(`[Screen Dictator] ${text}`)
  await speak(text)
}
