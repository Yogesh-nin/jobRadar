import axios from 'axios'
import { slugify } from '../../normalizer.js'

function extractCompanyId(url) {
  const m = url.match(/smartrecruiters\.com\/([^/?#]+)/)
  return m ? m[1] : null
}

export async function scrape(company) {
  const companyId = extractCompanyId(company.url)
  if (!companyId) throw new Error(`Cannot extract SmartRecruiters company ID from ${company.url}`)

  const res = await axios.get(
    `https://api.smartrecruiters.com/v1/companies/${companyId}/postings`
  )
  const jobs = res.data.content || []

  return jobs.map(j => ({
    id: `${slugify(company.name)}:${j.id}`,
    title: j.name,
    company: company.name,
    location: [j.location?.city, j.location?.country].filter(Boolean).join(', ') || 'Unknown',
    url: j.ref || company.url,
    postedAt: j.releasedDate || null,
    description: '',
    source: 'smartrecruiters',
    score: 0,
    matchedKeywords: []
  }))
}
