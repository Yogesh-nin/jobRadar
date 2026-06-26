import axios from 'axios'
import { slugify, truncate } from '../../normalizer.js'

function extractSlug(url) {
  const m = url.match(/boards\.greenhouse\.io\/([^/?#]+)/)
    || url.match(/greenhouse\.io\/([^/?#]+)/)
  return m ? m[1] : null
}

export async function scrape(company) {
  const slug = extractSlug(company.url)
  if (!slug) throw new Error(`Cannot extract Greenhouse slug from ${company.url}`)

  const res = await axios.get(
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`
  )
  const jobs = res.data.jobs || []

  return jobs.map(j => ({
    id: `${slugify(company.name)}:${j.id}`,
    title: j.title,
    company: company.name,
    location: j.location?.name || 'Unknown',
    url: j.absolute_url || `https://boards.greenhouse.io/${slug}/jobs/${j.id}`,
    postedAt: j.updated_at || null,
    description: truncate(j.content),
    source: 'greenhouse',
    score: 0,
    matchedKeywords: []
  }))
}
