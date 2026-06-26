import { chromium } from 'playwright'
import { detect } from '../detector.js'

export async function scrape(company, companiesData, strategyRunner) {
  let iframeSrc = null

  // Phase 1: open the outer page and find a job/career iframe
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page
      .goto(company.url, { timeout: 15000, waitUntil: 'domcontentloaded' })
      .catch(() => {})

    iframeSrc = await page.evaluate(() => {
      const iframes = document.querySelectorAll('iframe')
      for (const iframe of iframes) {
        const src = iframe.src || iframe.getAttribute('src') || ''
        if (
          /job|career|greenhouse|lever|ashby|workday|smartrecruiters|breezy|teamtailor/i.test(src)
        ) {
          return src
        }
      }
      return null
    })
  } finally {
    await browser.close()
  }

  if (!iframeSrc) throw new Error(`No job iframe found on ${company.url}`)

  // Phase 2: detect strategy for the iframe URL and run it
  const iframeCompany = {
    name: company.name,
    url: iframeSrc,
    strategy: 'auto',
    _detectedStrategy: null,
    _apiUrl: null
  }

  const { strategy, apiUrl } = await detect(iframeCompany, companiesData || [])
  iframeCompany._detectedStrategy = strategy
  if (apiUrl) iframeCompany._apiUrl = apiUrl

  const jobs = await strategyRunner(iframeCompany, strategy, companiesData)
  return jobs.map(j => ({ ...j, source: 'iframe', company: company.name }))
}
