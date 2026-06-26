import axios from 'axios'
import { slugify } from '../../normalizer.js'

function extractWorkdayInfo(url) {
  // Host may be {company}.myworkdayjobs.com or {company}.wd{N}.myworkdayjobs.com
  // Path may have an optional locale segment like en-US/ before the jobboard name
  const m = url.match(
    /https?:\/\/(([a-zA-Z0-9-]+)(?:\.[a-z0-9]+)?)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)/
  )
  if (!m) return null
  return { host: m[1], tenant: m[2], jobboard: m[3] }
}

export async function scrape(company) {
  const info = extractWorkdayInfo(company.url)
  if (!info) throw new Error(`Cannot extract Workday info from ${company.url}`)

  const { host, tenant, jobboard } = info
  const apiUrl = `https://${host}.myworkdayjobs.com/wday/cxs/${tenant}/${jobboard}/jobs`

  const allJobs = []
  let offset = 0
  let total = null
  const limit = 20

  while (true) {
    const res = await axios.post(apiUrl, {
      appliedFacets: {},
      limit,
      offset,
      searchText: ''
    })
    const postings = res.data.jobPostings || []
    allJobs.push(...postings)

    // Only trust total from the first response; later pages may omit it
    if (total === null) total = res.data.total || 0
    offset += limit
    if (postings.length === 0 || offset >= total) break
  }

  return allJobs.map(j => ({
    id: `${slugify(company.name)}:${j.jobReqId || slugify(j.title)}`,
    title: j.title,
    company: company.name,
    location: j.locationsText || 'Unknown',
    url: `https://${host}.myworkdayjobs.com/${jobboard}/${(j.externalPath || '').replace(/^\/+/, '')}`,
    postedAt: j.postedOn || null,
    description: '',
    source: 'workday',
    score: 0,
    matchedKeywords: []
  }))
}
