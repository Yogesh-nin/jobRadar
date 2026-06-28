import axios from 'axios'
import { slugify } from '../../normalizer.js'

function extractSubdomain(url) {
  const m = url.match(/https?:\/\/([^.]+)\.teamtailor\.com/)
  return m ? m[1] : null
}

export async function scrape(company) {
  const subdomain = extractSubdomain(company.url)
  if (!subdomain) throw new Error(`Cannot extract Teamtailor subdomain from ${company.url}`)

  const headers = {
    Authorization: 'Token token=NOT_NEEDED',
    'X-Api-Version': '20210218'
  }

  const jobs = []
  let url = `https://api.teamtailor.com/v1/jobs?page[size]=30`

  while (url) {
    let res
    try {
      res = await axios.get(url, { headers })
    } catch (err) {
      if (err.response?.status === 401) throw new Error('TEAMTAILOR_AUTH_REQUIRED')
      throw err
    }
    jobs.push(...(res.data.data || []))
    url = res.data.links?.next || null
  }

  return jobs.map(j => ({
    id: `${slugify(company.name)}:${j.id}`,
    title: j.attributes?.title || 'Unknown',
    company: company.name,
    location: j.attributes?.remote ? 'Remote' : 'Unknown',
    url: j.links?.['careersite-job-url'] || company.url,
    postedAt: j.attributes?.['created-at'] || null,
    description: '',
    source: 'teamtailor',
    score: 0,
    matchedKeywords: []
  }))
}
