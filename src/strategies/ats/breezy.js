import axios from 'axios'
import { slugify } from '../../normalizer.js'

function extractSlug(url) {
  const m = url.match(/https?:\/\/([^.]+)\.breezy\.hr/)
  return m ? m[1] : null
}

export async function scrape(company) {
  const slug = extractSlug(company.url)
  if (!slug) throw new Error(`Cannot extract Breezy slug from ${company.url}`)

  const res = await axios.get(`https://${slug}.breezy.hr/json`)
  const jobs = Array.isArray(res.data) ? res.data : []

  return jobs.map(j => ({
    id: `${slugify(company.name)}:${j.id}`,
    title: j.name,
    company: company.name,
    location: j.location?.name || 'Unknown',
    url: j.url || `https://${slug}.breezy.hr/${j.id}`,
    postedAt: j.published_date || null,
    description: j.category?.name || '',
    source: 'breezy',
    score: 0,
    matchedKeywords: []
  }))
}
