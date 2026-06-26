import axios from 'axios'
import { slugify, truncate } from '../../normalizer.js'

function parseUrl(url) {
  const parsed = new URL(url)
  const domain = parsed.origin
  const token = parsed.searchParams.get('token')
  const source = parsed.searchParams.get('source') || 'CAREERSITE'
  // Hash format: #list/location=Bangalore+Gurgaon+Pune
  const locationMatch = parsed.hash.match(/[?&/]location=([^&/]+)/)
  const location = locationMatch ? decodeURIComponent(locationMatch[1]) : null
  return { domain, token, source, location }
}

async function fetchPage(domain, token, source, location, page, pagesize) {
  const params = { page, search: '*:*', token, source, pagesize }
  if (location) params.location = location
  const body = `careerSiteUrlParams=${encodeURIComponent(JSON.stringify(params))}&lang=en`
  const res = await axios.post(
    `${domain}/candidate/candidatejobsearch`,
    body,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )
  return res.data
}

export async function scrape(company) {
  const { domain, token, source, location } = parseUrl(company.url)
  if (!domain || !token) throw new Error(`Cannot parse RippleHire URL: ${company.url}`)

  const PAGE_SIZE = 100
  const first = await fetchPage(domain, token, source, location, 0, PAGE_SIZE)
  const total = first.totalJobCount || 0
  let jobs = first.jobVoList || []

  const pages = Math.ceil(total / PAGE_SIZE)
  for (let p = 1; p < pages; p++) {
    const data = await fetchPage(domain, token, source, location, p, PAGE_SIZE)
    jobs = jobs.concat(data.jobVoList || [])
  }

  return jobs.map(j => {
    const loc = [...new Set([j.locations, j.jobLocation].filter(Boolean))].join(', ') || 'Unknown'
    const id = String(j.jobSeq || slugify(j.jobTitle || 'unknown'))
    const jobUrl = j.jobSeq
      ? `${domain}/candidate/?token=${token}&source=${source}#detail/${j.jobSeq}`
      : company.url
    return {
      id: `${slugify(company.name)}:${id}`,
      title: j.jobTitle || 'Unknown',
      company: company.name,
      location: loc,
      url: jobUrl,
      postedAt: j.jobPostingDate || j.openDate || null,
      description: truncate(j.jobDesc || ''),
      source: 'ripplehire',
      score: 0,
      matchedKeywords: [],
    }
  })
}
