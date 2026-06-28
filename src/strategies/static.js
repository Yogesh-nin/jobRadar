import axios from 'axios'
import { load } from 'cheerio'
import { slugify } from '../normalizer.js'
import { isValidJobUrl, isValidLinkText, NAV_SELECTOR } from '../noiseFilter.js'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const CONTAINER_SELECTORS = ['[class*="job"]', 'article', 'ul li', 'tr']

export async function scrape(company) {
  const res = await axios.get(company.url, {
    headers: { 'User-Agent': USER_AGENT },
    timeout: 15000
  })

  const $ = load(res.data)

  // Layer 2: strip nav/footer chrome before searching
  $(NAV_SELECTOR).remove()

  const candidates = []

  for (const sel of CONTAINER_SELECTORS) {
    const els = $(sel)
    if (els.length <= 2) continue

    els.each((_, el) => {
      const $el = $(el)
      if ($el.find('a').length === 0) return

      const titleEl = $el.find('h2, h3, [class*="title"], strong').first()
      const title = titleEl.text().trim() || $el.find('a').first().text().trim()

      const locationEl = $el.find('[class*="location"], [class*="city"]').first()
      const locationRaw = locationEl.text().trim().split('\n')[0].trim()
      const location = locationRaw.length <= 80 ? locationRaw : ''

      $el.find('a').each((_, a) => {
        const href = $(a).attr('href') || ''
        if (!href) return

        let fullUrl
        try {
          fullUrl = new URL(href, company.url).href
        } catch {
          return
        }

        const linkText = $(a).text().trim()

        if (isValidJobUrl(fullUrl, company.url) && isValidLinkText(linkText)) {
          candidates.push({ title: title || linkText, location, url: fullUrl })
        }
      })
    })

    if (candidates.length > 0) break
  }

  // Fallback: find <a> tags that link to valid job paths and have a heading inside
  if (candidates.length === 0) {
    $('a[href]').each((_, el) => {
      const $el = $(el)
      const href = $el.attr('href') || ''
      let fullUrl
      try { fullUrl = new URL(href, company.url).href } catch { return }
      if (!isValidJobUrl(fullUrl, company.url) || fullUrl === company.url) return

      const title = $el.find('h1, h2, h3, h4').first().text().trim() || $el.text().split('\n')[0].trim()
      if (!isValidLinkText(title)) return

      candidates.push({ title, location: '', url: fullUrl })
    })
  }

  return candidates.map(c => ({
    id: `${slugify(company.name)}:${slugify(c.title)}:${slugify(c.location || '')}`,
    title: c.title,
    company: company.name,
    location: c.location || 'Unknown',
    url: c.url,
    postedAt: null,
    description: '',
    source: 'static',
    score: 0,
    matchedKeywords: []
  }))
}
