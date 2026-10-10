import { copyFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const distVoice = path.join(root, 'dist', 'voice')

const voiceFiles = [
  'content.js',
  'popup.html',
  'popup.js',
  'popup.css',
  'permission.html',
  'permission.js',
]

await mkdir(distVoice, { recursive: true })

let copied = 0
for (const file of voiceFiles) {
  const src = path.join(root, file)
  if (!existsSync(src)) {
    console.warn(`[copy-voice] missing: ${file}`)
    continue
  }
  await copyFile(src, path.join(distVoice, file))
  copied++
}

console.log(`[copy-voice] copied ${copied} file(s) to dist/voice/`)
