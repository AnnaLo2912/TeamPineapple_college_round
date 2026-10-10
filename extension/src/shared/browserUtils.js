/**
 * Handsfree Cross-Browser Utilities
 * Provides unified URL filtering and browser namespace abstractions
 * supporting Google Chrome, Microsoft Edge, Brave, Opera, Vivaldi, and Mozilla Firefox.
 */

/**
 * Universal browser API accessor (supports both `browser.*` and `chrome.*` namespaces)
 */
export function getBrowserAPI() {
  if (typeof globalThis.browser !== 'undefined' && globalThis.browser?.runtime) {
    return globalThis.browser
  }
  if (typeof globalThis.chrome !== 'undefined' && globalThis.chrome?.runtime) {
    return globalThis.chrome
  }
  return null
}

/**
 * Validates whether the given URL is supported for content script injection & interaction.
 * Filters out internal browser schemes (Chrome, Edge, Brave, Opera, Firefox)
 * as well as extension web stores that restrict extension scripts.
 *
 * @param {string | undefined | null} url
 * @returns {boolean}
 */
export function isSupportedPage(url) {
  if (!url || typeof url !== 'string') return false
  const lower = url.toLowerCase().trim()

  // Internal browser schemes
  if (
    lower.startsWith('chrome://') ||
    lower.startsWith('chrome-extension://') ||
    lower.startsWith('chrome-search://') ||
    lower.startsWith('edge://') ||
    lower.startsWith('extension://') ||
    lower.startsWith('brave://') ||
    lower.startsWith('opera://') ||
    lower.startsWith('vivaldi://') ||
    lower.startsWith('about:') ||
    lower.startsWith('moz-extension://') ||
    lower.startsWith('devtools://') ||
    lower.startsWith('view-source:') ||
    lower.startsWith('data:') ||
    lower.startsWith('javascript:')
  ) {
    return false
  }

  // Official browser extension web stores (script injection is forbidden by browser engines)
  if (
    lower.includes('chromewebstore.google.com') ||
    lower.includes('chrome.google.com/webstore') ||
    lower.includes('microsoftedge.microsoft.com/addons') ||
    lower.includes('addons.mozilla.org')
  ) {
    return false
  }

  return true
}
