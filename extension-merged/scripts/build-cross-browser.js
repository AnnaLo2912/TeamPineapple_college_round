import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const distDir = path.join(rootDir, 'dist')
const distFirefoxDir = path.join(rootDir, 'dist-firefox')
const publicDir = path.join(rootDir, 'public')

console.log('🚀 [Handsfree Build] Starting multi-browser build...')

// 1. Run Vite builds
console.log('📦 [1/4] Building main extension bundle with Vite...')
execSync('npx vite build --mode production', { cwd: rootDir, stdio: 'inherit' })

console.log('📦 [2/4] Building content script bundle with Vite...')
execSync('npx vite build --config vite.content.config.js', { cwd: rootDir, stdio: 'inherit' })

console.log('📦 [3/4] Copying voice modules into distribution...')
execSync('node scripts/copy-voice.mjs', { cwd: rootDir, stdio: 'inherit' })

// 2. Ensure Chromium manifest in dist/
console.log('🌐 [4/4] Preparing Chromium distribution in dist/ (Chrome, Edge, Brave, Opera, Vivaldi)...')
const chromiumManifestPath = path.join(publicDir, 'manifest.json')
if (fs.existsSync(chromiumManifestPath)) {
  fs.copyFileSync(chromiumManifestPath, path.join(distDir, 'manifest.json'))
}

// 3. Prepare Firefox distribution in dist-firefox/
console.log('🦊 Preparing Firefox distribution in dist-firefox/...')
if (fs.existsSync(distFirefoxDir)) {
  fs.rmSync(distFirefoxDir, { recursive: true, force: true })
}
fs.cpSync(distDir, distFirefoxDir, { recursive: true })

// Write Firefox manifest
const firefoxManifestSource = path.join(publicDir, 'manifest.firefox.json')
const firefoxManifestTarget = path.join(distFirefoxDir, 'manifest.json')

if (fs.existsSync(firefoxManifestSource)) {
  fs.copyFileSync(firefoxManifestSource, firefoxManifestTarget)
} else {
  // Dynamically generate from chromium manifest if source missing
  const raw = fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf-8')
  const manifest = JSON.parse(raw)

  // Remove Chromium-only offscreen permission
  manifest.permissions = (manifest.permissions || []).filter((p) => p !== 'offscreen')

  // Switch to Firefox background scripts
  manifest.background = {
    scripts: ['background.js'],
    type: 'module',
  }

  // Ensure gecko ID
  manifest.browser_specific_settings = {
    gecko: {
      id: 'handsfree@teampineapple.com',
      strict_min_version: '109.0',
    },
  }

  fs.writeFileSync(firefoxManifestTarget, JSON.stringify(manifest, null, 2))
}

console.log('\n✅ [Handsfree Build] Multi-browser build finished successfully!')
console.log('──────────────────────────────────────────────────────────────────')
console.log('📂 CHROMIUM BROWSERS (Chrome, Edge, Brave, Opera, Vivaldi, Arc):')
console.log(`   Path: ${distDir}`)
console.log('   • Chrome / Brave: Go to chrome://extensions -> Developer mode -> "Load unpacked"')
console.log('   • MS Edge:        Go to edge://extensions -> Developer mode -> "Load unpacked"')
console.log('   • Opera:          Go to opera://extensions -> Developer mode -> "Load unpacked"')
console.log('\n📂 MOZILLA FIREFOX:')
console.log(`   Path: ${distFirefoxDir}`)
console.log('   • Firefox:        Go to about:debugging#/runtime/this-firefox -> "Load Temporary Add-on..."')
console.log(`                     Select: ${path.join(distFirefoxDir, 'manifest.json')}`)
console.log('──────────────────────────────────────────────────────────────────\n')
