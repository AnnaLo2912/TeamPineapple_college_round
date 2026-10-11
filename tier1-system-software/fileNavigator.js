import fs from 'fs'
import path from 'path'
import os from 'os'
import { exec } from 'child_process'
import { speak, playEarcon } from './ttsEngine.js'

/**
 * File Navigator & Document Opener
 * Enables blind users and handsfree users to search, open, and dictate
 * files and folders across Downloads, Documents, Desktop, and project directories.
 */

function getSearchDirectories() {
  const dirs = [
    path.join(os.homedir(), 'Downloads'),
    path.join(os.homedir(), 'Documents'),
    path.join(os.homedir(), 'OneDrive', 'Documents'),
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'OneDrive', 'Desktop'),
    path.resolve(process.cwd(), '..')
  ]
  return dirs.filter(d => fs.existsSync(d))
}

/**
 * Finds and opens a file or folder matching the user query
 */
export async function findAndOpenFile(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string') return false

  let query = rawQuery
    .replace(/^open\s+file\s+/i, '')
    .replace(/^open\s+folder\s+/i, '')
    .replace(/^open\s+/i, '')
    .replace(/\s+file$/i, '')
    .replace(/\s+folder$/i, '')
    .trim()
    .toLowerCase()

  if (!query || query.length < 2) return false

  // Ignore reserved system keywords
  const reserved = ['google', 'browser', 'chrome', 'notepad', 'calculator', 'settings', 'task manager', 'help']
  if (reserved.includes(query)) return false

  const searchDirs = getSearchDirectories()
  let bestMatch = null

  for (const dir of searchDirs) {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true })
      for (const item of items) {
        const name = item.name
        if (!name || name.startsWith('.') || name.toLowerCase() === 'desktop.ini') continue

        const nameLower = name.toLowerCase()
        const baseNameLower = path.parse(name).name.toLowerCase()

        // 1. Exact match on base name or full name
        if (baseNameLower === query || nameLower === query) {
          bestMatch = { name, fullPath: path.join(dir, name), isDirectory: item.isDirectory() }
          break
        }

        // 2. Starts with query
        if (!bestMatch && (baseNameLower.startsWith(query) || nameLower.startsWith(query))) {
          bestMatch = { name, fullPath: path.join(dir, name), isDirectory: item.isDirectory() }
        }

        // 3. Contains query
        if (!bestMatch && (baseNameLower.includes(query) || nameLower.includes(query))) {
          bestMatch = { name, fullPath: path.join(dir, name), isDirectory: item.isDirectory() }
        }
      }
      if (bestMatch && (path.parse(bestMatch.name).name.toLowerCase() === query || bestMatch.name.toLowerCase() === query)) {
        break
      }
    } catch {}
  }

  if (bestMatch) {
    playEarcon('success')
    const typeLabel = bestMatch.isDirectory ? 'folder' : 'file'
    const announcement = `Opening ${typeLabel} ${bestMatch.name}`
    console.log(`📂 [File Navigator] ${announcement} (${bestMatch.fullPath})`)
    await speak(announcement)

    if (bestMatch.isDirectory) {
      exec(`explorer.exe "${bestMatch.fullPath}"`)
    } else {
      exec(`start "" "${bestMatch.fullPath}"`)
    }
    return true
  }

  return false
}

/**
 * Dictates the contents of a specific folder (e.g. Downloads, Documents, Desktop)
 */
export async function dictateFolder(folderCategory = 'downloads') {
  playEarcon('listen')

  let targetDir = path.join(os.homedir(), 'Downloads')
  let folderLabel = 'Downloads'

  const lower = folderCategory.toLowerCase()
  if (lower.includes('document')) {
    targetDir = fs.existsSync(path.join(os.homedir(), 'OneDrive', 'Documents'))
      ? path.join(os.homedir(), 'OneDrive', 'Documents')
      : path.join(os.homedir(), 'Documents')
    folderLabel = 'Documents'
  } else if (lower.includes('desktop')) {
    targetDir = fs.existsSync(path.join(os.homedir(), 'OneDrive', 'Desktop'))
      ? path.join(os.homedir(), 'OneDrive', 'Desktop')
      : path.join(os.homedir(), 'Desktop')
    folderLabel = 'Desktop'
  } else if (lower.includes('project')) {
    targetDir = path.resolve(process.cwd(), '..')
    folderLabel = 'Project directory'
  }

  if (!fs.existsSync(targetDir)) {
    const errorMsg = `Folder ${folderLabel} could not be located.`
    console.log(`📂 [File Navigator] ${errorMsg}`)
    await speak(errorMsg)
    return
  }

  try {
    const items = fs.readdirSync(targetDir, { withFileTypes: true })
    const folders = []
    const files = []

    for (const item of items) {
      const name = item.name
      if (!name || name.startsWith('.') || name.toLowerCase() === 'desktop.ini') continue
      if (item.isDirectory()) {
        folders.push(name)
      } else {
        files.push(path.parse(name).name)
      }
    }

    console.log(`\n📂 [File Navigator] In ${folderLabel}:`)
    console.log(`• Folders (${folders.length}): ${folders.slice(0, 5).join(', ') || 'None'}`)
    console.log(`• Files (${files.length}): ${files.slice(0, 5).join(', ') || 'None'}\n`)

    let speech = `In ${folderLabel}, `
    if (folders.length > 0) {
      speech += `folders are: ${folders.slice(0, 4).join(', ')}. `
    }
    if (files.length > 0) {
      speech += `files are: ${files.slice(0, 5).join(', ')}. `
    }
    if (folders.length === 0 && files.length === 0) {
      speech += `this folder is currently empty. `
    } else {
      speech += `You can say 'Open ${files[0] || folders[0]}' to open it directly.`
    }

    console.log(`🗣️  [Voice Assistant]: "${speech}"`)
    await speak(speech)
  } catch (err) {
    console.error(`[File Navigator Error]:`, err)
  }
}
