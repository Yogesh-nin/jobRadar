import axios from 'axios'
import { slugify, truncate } from '../../normalizer.js'

function extractSlug(url) {
  const m = url.match(/jobs\.lever\.co\/([^/?#]+)/)
    || url.match(/lever\.co\/([^/?#]+)/)
  return m ? m[1] : null
}

export async function scrape(company) {
  const slug = extractSlug(company.url)
  if (!slug) throw new Error(`Cannot extract Lever slug from ${company.url}`)

  const res = await axios.get(`https://api.lever.co/v0/postings/${slug}?mode=json`)
  const jobs = Array.isArray(res.data) ? res.data : []

  return jobs.map(j => ({
    id: `${slugify(company.name)}:${j.id}`,
    title: j.text,
    company: company.name,
    location: j.categories?.location || 'Unknown',
    url: j.hostedUrl || `https://jobs.lever.co/${slug}/${j.id}`,
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    description: truncate(j.descriptionPlain),
    source: 'lever',
    score: 0,
    matchedKeywords: []
  }))
}
