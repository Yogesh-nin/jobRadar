import { chromium } from 'playwright'
import { slugify } from '../normalizer.js'
import { isValidJobUrl, isValidLinkText, NAV_SELECTOR } from '../noiseFilter.js'

const JOB_SELECTORS = [
  '[data-testid*="job"]',
  '[class*="job-card"]',
  '[class*="job-listing"]',
  '[class*="position"]',
  'article',
  'li',
  'table tr',
]

export async function scrape(company) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page
      .goto(company.url, { timeout: 15000, waitUntil: 'domcontentloaded' })
      .catch(() => {})

    let usedSelector = null

    for (const selector of JOB_SELECTORS) {
      try {
        await page.waitForSelector(selector, { timeout: 8000 })
        const count = await page.$$eval(selector, els => els.length)
        if (count > 0) {
          usedSelector = selector
          break
        }
      } catch {
        // selector not found within timeout — try next
      }
    }

    if (!usedSelector) return []

    // Run extraction in browser context; pass NAV_SELECTOR as argument
    const rawJobs = await page.$$eval(
      usedSelector,
      (elements, navSel) => {
        return elements
          .map(el => {
            // Layer 2: skip elements inside nav/footer chrome
            if (el.closest(navSel)) return null

            const titleEl = el.querySelector('h2, h3, [class*="title"], strong')
            const title = titleEl?.textContent?.trim() || ''

            const locationEl = el.querySelector('[class*="location"], [data-testid*="location"]')
            const location = locationEl?.textContent?.trim() || ''

            const links = Array.from(el.querySelectorAll('a'))
            const preferred = links.find(a => /job|detail|\d{5,}/i.test(a.href))
            const link = preferred || links[0]
            const url = link?.href || ''
            const linkText = link?.textContent?.trim() || ''

            if (!title && !url) return null
            return { title, location, url, linkText }
          })
          .filter(Boolean)
      },
      NAV_SELECTOR
    )

    const jobs = []
    for (const raw of rawJobs) {
      // Layers 1 & 3 applied in Node.js
      if (!isValidJobUrl(raw.url, company.url)) continue
      if (raw.linkText && !isValidLinkText(raw.linkText) && !raw.title) continue
      if (!raw.title) continue

      jobs.push({
        id: `${slugify(company.name)}:${slugify(raw.title)}:${slugify(raw.location || '')}`,
        title: raw.title,
        company: company.name,
        location: raw.location || 'Unknown',
        url: raw.url || company.url,
        postedAt: null,
        description: '',
        source: 'domwait',
        score: 0,
        matchedKeywords: []
      })
    }

    return jobs
  } finally {
    await browser.close()
  }
}
