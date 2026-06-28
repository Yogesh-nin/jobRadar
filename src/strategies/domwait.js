import { chromium } from 'playwright'
import { load } from 'cheerio'
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

async function dismissCookieBanner(page) {
  const patterns = [
    '[aria-label*="decline" i]',
    '[aria-label*="reject" i]',
    'button:has-text("Decline")',
    'button:has-text("Reject all")',
    'button:has-text("Accept")',
  ]
  for (const sel of patterns) {
    try {
      const btn = page.locator(sel).first()
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click()
        await page.waitForTimeout(800)
        return
      }
    } catch {}
  }
}

// Fetch extra pages (show_more / load_more style pagination) via direct HTTP requests
// so we never risk a Turbo/SPA navigation breaking the current page state.
async function fetchExtraPages(page, baseUrl) {
  const extraHtmlBlocks = []

  // Find any "show more" / next-page link pattern in the current DOM
  const moreUrl = await page.evaluate(() => {
    const candidates = [
      ...document.querySelectorAll('a[href*="show_more"]'),
      ...document.querySelectorAll('a[href*="page="]'),
      ...document.querySelectorAll('a'),
    ]
    const btn = candidates.find(a =>
      /show.?more|load.?more|next.?page/i.test(a.href + a.textContent)
    )
    return btn ? btn.href : null
  })

  if (!moreUrl) return extraHtmlBlocks

  // Detect the URL pattern (replace page number to iterate)
  const pageMatch = moreUrl.match(/([?&]page=)(\d+)/) ||
                    moreUrl.match(/(show_more\?.*page=)(\d+)/) ||
                    moreUrl.match(/(\/show_more\?page=)(\d+)/)
  if (!pageMatch) return extraHtmlBlocks

  const [, prefix, startStr] = pageMatch
  let pageNum = parseInt(startStr)
  const urlBase = moreUrl.slice(0, moreUrl.indexOf(pageMatch[0]))

  while (true) {
    const nextUrl = urlBase + prefix + pageNum
    try {
      const res = await page.request.get(nextUrl, { timeout: 10000 })
      if (!res.ok()) break
      const html = await res.text()
      if (html.trim().length < 100) break
      extraHtmlBlocks.push({ html, baseUrl: nextUrl })
      pageNum++
    } catch {
      break
    }
  }

  return extraHtmlBlocks
}

function extractJobsFromHtml(html, pageUrl, companyUrl, companyName) {
  const $ = load(html)
  $(NAV_SELECTOR).remove()
  const jobs = []

  for (const sel of JOB_SELECTORS) {
    const els = $(sel)
    if (els.length === 0) continue

    els.each((_, el) => {
      const $el = $(el)
      const titleEl = $el.find('h2, h3, [class*="title"], strong').first()
      const title = titleEl.text().trim()

      const links = $el.find('a')
      let link = links.filter((_, a) => /job|detail|\d{5,}/i.test($(a).attr('href') || '')).first()
      if (!link.length) link = links.first()

      const href = link.attr('href') || ''
      let url
      try { url = new URL(href, pageUrl).href } catch { return }
      const linkText = link.text().trim()
      const finalTitle = title || linkText

      if (!isValidJobUrl(url, companyUrl)) return
      if (!isValidLinkText(finalTitle)) return

      jobs.push({
        id: `${slugify(companyName)}:${slugify(finalTitle)}`,
        title: finalTitle,
        company: companyName,
        location: 'Unknown',
        url,
        postedAt: null,
        description: '',
        source: 'domwait',
        score: 0,
        matchedKeywords: []
      })
    })

    if (jobs.length > 0) break
  }

  return jobs
}

export async function scrape(company) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page
      .goto(company.url, { timeout: 15000, waitUntil: 'domcontentloaded' })
      .catch(() => {})

    await page.waitForTimeout(2000)
    await dismissCookieBanner(page)

    // Scroll and click "Load More" buttons to trigger lazy-load / pagination
    const LOAD_MORE_SELECTOR = [
      'button:has-text("Load more")',
      'button:has-text("Show more")',
      'button:has-text("Load More")',
      'button:has-text("Show More")',
      '[class*="load-more"]',
      '[class*="show-more"]',
      '[data-testid*="load-more"]',
    ].join(', ')

    let prevHeight = 0
    for (let i = 0; i < 10; i++) {
      const newHeight = await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight)
        return document.body.scrollHeight
      })

      // Click any visible "Load More" button before checking height stabilisation
      try {
        const btn = page.locator(LOAD_MORE_SELECTOR).first()
        if (await btn.isVisible({ timeout: 1500 })) {
          await btn.click()
          await page.waitForTimeout(1500)
          continue  // keep looping after a successful click
        }
      } catch {}

      if (newHeight === prevHeight) break
      prevHeight = newHeight
      await page.waitForTimeout(1500)
    }

    // Collect extra pages via direct HTTP (safe — no page navigation)
    const extraPages = await fetchExtraPages(page, company.url)

    // Extract from the main rendered page
    let usedSelector = null
    for (const selector of JOB_SELECTORS) {
      try {
        await page.waitForSelector(selector, { timeout: 4000 })
        const count = await page.$$eval(selector, els => els.length)
        if (count > 0) { usedSelector = selector; break }
      } catch {}
    }

    const jobs = []

    if (usedSelector) {
      const rawJobs = await page.$$eval(
        usedSelector,
        (elements, navSel) => elements.map(el => {
          if (el.closest(navSel)) return null
          const titleEl = el.querySelector('h2, h3, [class*="title"], strong')
          const title = titleEl?.textContent?.trim() || ''
          const locationEl = el.querySelector('[class*="location"], [data-testid*="location"]')
          const locationRaw = locationEl?.textContent?.trim().split('\n')[0].trim() || ''
          const location = locationRaw.length <= 80 ? locationRaw : ''
          const links = Array.from(el.querySelectorAll('a'))
          const preferred = links.find(a => /job|detail|\d{5,}/i.test(a.href))
          const link = preferred || links[0]
          const url = link?.href || ''
          const linkText = link?.textContent?.trim() || ''
          if (!title && !url) return null
          return { title: title || linkText, location, url }
        }).filter(Boolean),
        NAV_SELECTOR
      )

      for (const raw of rawJobs) {
        if (!isValidJobUrl(raw.url, company.url)) continue
        if (!isValidLinkText(raw.title)) continue
        jobs.push({
          id: `${slugify(company.name)}:${slugify(raw.title)}`,
          title: raw.title,
          company: company.name,
          location: raw.location || 'Unknown',
          url: raw.url,
          postedAt: null,
          description: '',
          source: 'domwait',
          score: 0,
          matchedKeywords: []
        })
      }
    }

    // Merge extra pages
    for (const { html, baseUrl } of extraPages) {
      const extra = extractJobsFromHtml(html, baseUrl, company.url, company.name)
      jobs.push(...extra)
    }

    return jobs
  } finally {
    await browser.close()
  }
}
