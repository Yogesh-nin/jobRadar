import axios from 'axios'
import { chromium } from 'playwright'
import { slugify, truncate } from '../normalizer.js'

const JOB_ARRAY_KEYS = ['results', 'jobs', 'postings', 'data', 'items', 'searchResults', 'jobPostings']

function findJobsArray(data) {
  if (Array.isArray(data)) return data
  for (const key of JOB_ARRAY_KEYS) {
    if (Array.isArray(data[key])) return data[key]
  }
  // Fallback: find the first non-empty array value regardless of key name
  const fallback = Object.values(data).find(v => Array.isArray(v) && v.length > 0)
  return fallback || []
}

function extractJobFields(item) {
  const title = item.title || item.name || item.jobTitle || item.postingTitle || 'Unknown'
  const location =
    item.location?.name ||
    item.locationsText ||
    (Array.isArray(item.locations) ? item.locations[0]?.name : null) ||
    item.city ||
    'Unknown'
  const url =
    item.url || item.link || item.hostedUrl || item.absolute_url || item.postingUrl || ''
  const date =
    item.date || item.postedAt || item.publishedDate || item.postedOn || item.created_at || null
  const desc = item.description || item.descriptionPlain || item.snippet || ''
  const id = String(
    item.id || item.jobId || item.positionId || item.jobReqId || slugify(title)
  )
  return { title, location, url, date, desc, id }
}

// Returns true only for responses that look like a real jobs listing,
// not config files or translation bundles that also contain arrays.
function isJobsResponse(parsed) {
  const arr = Array.isArray(parsed)
    ? parsed
    : Object.values(parsed).find(v => Array.isArray(v))
  if (!arr) return false
  if (arr.length === 0) {
    // Empty result: trust it only when the parent object has pagination keys
    return !Array.isArray(parsed) &&
      Object.keys(parsed).some(k => /total|count|page/i.test(k))
  }
  const sample = arr[0]
  if (typeof sample !== 'object' || sample === null) return false
  return Object.keys(sample).some(k => /title|name|jobtitle|postingtitle/i.test(k))
}

// Load the page in a real browser so the site's own JS can make authenticated API calls.
// Uses Promise.race so the async response-body read never races against a fixed timeout.
async function captureViaPlaywright(pageUrl) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()

    let resolveCapture
    const capturePromise = new Promise(r => { resolveCapture = r })

    page.on('response', async response => {
      const ct = response.headers()['content-type'] || ''
      if (!ct.includes('application/json')) return
      try {
        const text = await response.text()
        if (!/jobs|postings|positions|results|openings|roles|listings/i.test(text)) return
        const parsed = JSON.parse(text)
        if (isJobsResponse(parsed)) resolveCapture(parsed)
      } catch {}
    })

    await page.goto(pageUrl, { timeout: 20000, waitUntil: 'domcontentloaded' }).catch(() => {})

    // Race: resolve as soon as we capture a valid jobs response, or null after 10 s
    return await Promise.race([
      capturePromise,
      new Promise(r => setTimeout(() => r(null), 10000)),
    ])
  } finally {
    await browser.close()
  }
}

function mapItems(items, company) {
  return items.map(item => {
    const f = extractJobFields(item)
    return {
      id: `${slugify(company.name)}:${f.id}`,
      title: f.title,
      company: company.name,
      location: f.location,
      url: f.url || company.url,
      postedAt: f.date ? new Date(f.date).toISOString() : null,
      description: truncate(f.desc),
      source: 'intercept',
      score: 0,
      matchedKeywords: []
    }
  })
}

export async function scrape(company, companiesData) {
  // Fast path: try cached API URL with axios (works for APIs that don't require browser auth)
  if (company._apiUrl) {
    try {
      const res = await axios.get(company._apiUrl)
      const items = findJobsArray(res.data)
      if (items.length > 0) return mapItems(items, company)
    } catch (err) {
      const status = err.response?.status
      // Auth errors or 404 → fall through to Playwright capture
      if (status !== 401 && status !== 403 && status !== 404) throw err
    }
  }

  // Playwright capture: the page's own JS makes the API call with full browser context
  // (session cookies, CSRF tokens, etc.) — we just read the response
  const rawData = await captureViaPlaywright(company.url)
  if (!rawData) throw new Error(`No API response captured for ${company.name}`)

  return mapItems(findJobsArray(rawData), company)
}
