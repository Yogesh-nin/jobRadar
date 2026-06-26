import { readFile, writeFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { chromium } from 'playwright'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COMPANIES_PATH = join(__dirname, '..', 'companies.json')

// Checked in order — first match wins
const ATS_SIGNATURES = [
  ['jobs.apple.com', 'intercept'],
  ['boards.greenhouse.io', 'greenhouse'],
  ['greenhouse.io', 'greenhouse'],
  ['jobs.lever.co', 'lever'],
  ['lever.co', 'lever'],
  ['ashbyhq.com', 'ashby'],
  ['ashby.com/jobs', 'ashby'],
  ['myworkdayjobs.com', 'workday'],
  ['smartrecruiters.com', 'smartrecruiters'],
  ['breezy.hr', 'breezy'],
  ['teamtailor.com', 'teamtailor'],
  ['recruitee.com', 'recruitee'],
  ['ripplehire.com', 'ripplehire'],
  ['bamboohr.com', 'bamboohr'],
  ['workable.com', 'workable'],
  ['icims.com', 'static'],
  ['pinpoint.one', 'pinpoint'],
]

function detectByUrl(url) {
  for (const [sig, strategy] of ATS_SIGNATURES) {
    if (url.includes(sig)) return strategy
  }
  return null
}

async function pageProbe(url) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    let capturedApiUrl = null

    page.on('response', async (response) => {
      if (capturedApiUrl) return
      const contentType = response.headers()['content-type'] || ''
      if (!contentType.includes('application/json')) return
      try {
        const body = await response.text()
        if (!/jobs|postings|positions|results|openings/i.test(body)) return
        const parsed = JSON.parse(body)
        const isUsable = Array.isArray(parsed)
          ? parsed.length > 0
          : typeof parsed === 'object' &&
            Object.values(parsed).some(v => Array.isArray(v) && v.length > 0)
        if (isUsable) capturedApiUrl = response.url()
      } catch {}
    })

    await page.goto(url, { timeout: 6000, waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(5000)

    if (capturedApiUrl) {
      return { strategy: 'intercept', apiUrl: capturedApiUrl }
    }

    const bodyLen = await page.evaluate(() => document.body?.innerHTML?.length ?? 0).catch(() => 0)
    if (bodyLen < 500) {
      return { strategy: 'domwait' }
    }

    const hasJobIframe = await page.evaluate(() => {
      const iframes = document.querySelectorAll('iframe')
      return Array.from(iframes).some(f => {
        try { return /job|career/i.test(new URL(f.src).pathname) } catch { return false }
      })
    }).catch(() => false)

    if (hasJobIframe) {
      return { strategy: 'iframe' }
    }

    return { strategy: 'static' }
  } finally {
    await browser.close()
  }
}

async function cacheStrategy(url, strategy, apiUrl, companiesData) {
  for (const c of companiesData) {
    if (c.url === url) {
      c._detectedStrategy = strategy
      if (apiUrl) c._apiUrl = apiUrl
    }
  }
  await writeFile(COMPANIES_PATH, JSON.stringify(companiesData, null, 2))
}

export async function detect(company, companiesData) {
  // Return cached result from a previous run
  if (company._detectedStrategy) {
    return { strategy: company._detectedStrategy, apiUrl: company._apiUrl }
  }

  // Step 1: string-match the URL against known ATS signatures
  const urlStrategy = detectByUrl(company.url)
  if (urlStrategy) {
    await cacheStrategy(company.url, urlStrategy, null, companiesData)
    return { strategy: urlStrategy }
  }

  // Step 2: open the page and probe for API calls / DOM shape
  const result = await pageProbe(company.url)
  await cacheStrategy(company.url, result.strategy, result.apiUrl || null, companiesData)
  return result
}
