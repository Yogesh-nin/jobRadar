import axios from 'axios'
import { slugify, truncate } from '../normalizer.js'

export async function scrape(company, profile) {
  if (!process.env.RAPIDAPI_KEY) throw new Error('RAPIDAPI_KEY not set in .env')

  // Build query: company name + top title keywords for relevance
  const keywords = (profile?.title_keywords || []).slice(0, 3).join(' ')
  const query = keywords ? `${company.name} ${keywords}` : company.name

  const res = await axios.get('https://jsearch.p.rapidapi.com/search', {
    params: {
      query,
      num_pages: '3',
      date_posted: 'month',
    },
    headers: {
      'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
    },
    timeout: 15000,
  })

  const jobs = (res.data.data || []).filter(j =>
    j.employer_name?.toLowerCase().includes(company.name.toLowerCase())
  )

  return jobs.map(j => ({
    id: `${slugify(company.name)}:${j.job_id}`,
    title: j.job_title,
    company: company.name,
    location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ') || 'Unknown',
    url: j.job_apply_link || j.job_google_link || company.url,
    postedAt: j.job_posted_at_datetime_utc || null,
    description: truncate(j.job_description || ''),
    source: 'jobsearch',
    score: 0,
    matchedKeywords: [],
  }))
}
