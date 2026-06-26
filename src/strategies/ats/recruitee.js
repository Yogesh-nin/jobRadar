import axios from 'axios'
import { slugify, truncate } from '../../normalizer.js'

function extractSlug(url) {
  const m = url.match(/https?:\/\/([^.]+)\.recruitee\.com/)
  return m ? m[1] : null
}

export async function scrape(company) {
  const slug = extractSlug(company.url)
  if (!slug) throw new Error(`Cannot extract Recruitee slug from ${company.url}`)

  const res = await axios.get(`https://${slug}.recruitee.com/api/offers/`)
  const jobs = res.data.offers || []

  return jobs.map(j => ({
    id: `${slugify(company.name)}:${j.id}`,
    title: j.title,
    company: company.name,
    location: j.location || [j.city, j.country].filter(Boolean).join(', ') || 'Unknown',
    url: j.careers_url || j.careers_apply_url || company.url,
    postedAt: j.published_at ? new Date(j.published_at.replace(' UTC', 'Z').replace(' ', 'T')).toISOString() : null,
    description: truncate(j.description || j.requirements || ''),
    source: 'recruitee',
    score: 0,
    matchedKeywords: [],
  }))
}
