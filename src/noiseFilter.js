const REJECT_TEXTS = new Set([
  'privacy', 'cookie', 'legal', 'terms', 'accessibility', 'about us',
  'contact', 'home', 'back', 'next', 'previous', 'load more', 'see all',
  'sign in', 'login', 'apply now'
])

// CSS selector for navigation/chrome containers — used in browser-side filtering
export const NAV_SELECTOR =
  'header, footer, nav, [role="navigation"], [class*="menu"], [class*="nav"], ' +
  '[class*="footer"], [class*="sidebar"], [class*="cookie"], [class*="banner"], [class*="social"]'

export function isValidJobUrl(url, baseUrl) {
  if (!url) return false
  try {
    const path = new URL(url).pathname
    const hasJobPath = /job|career|position|opening|role|vacancy|detail|posting/i.test(path)
    const hasNumericId = /\/\d{5,}(\/|$)/.test(path)
    const isDifferentPage = url !== baseUrl
    return hasJobPath || hasNumericId || isDifferentPage
  } catch {
    return false
  }
}

export function isValidLinkText(text) {
  if (!text) return false
  const lower = text.toLowerCase().trim()
  if (REJECT_TEXTS.has(lower)) return false
  // Reject single-word links (nav icons, logos) but allow job titles like "Full Stack Engineer"
  const wordCount = lower.split(/\s+/).filter(Boolean).length
  return wordCount >= 2
}
