import axios from 'axios'
import { slugify, truncate } from '../../normalizer.js'

function extractSlug(url) {
  const m = url.match(/ashbyhq\.com\/([^/?#]+)/)
    || url.match(/ashby\.com\/jobs\/([^/?#]+)/)
  return m ? m[1] : null
}

const GRAPHQL_QUERY = `query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {
  jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) {
    jobPostings { id title locationName employmentType }
  }
}`

export async function scrape(company) {
  const slug = extractSlug(company.url)
  if (!slug) throw new Error(`Cannot extract Ashby slug from ${company.url}`)

  // Ashby's public job board uses a GraphQL endpoint (the posting-api REST path returns 401)
  const res = await axios.post(
    'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams',
    {
      operationName: 'ApiJobBoardWithTeams',
      variables: { organizationHostedJobsPageName: slug },
      query: GRAPHQL_QUERY,
    },
    { headers: { 'Content-Type': 'application/json' } }
  )

  const jobs = res.data?.data?.jobBoard?.jobPostings || []

  return jobs.map(j => ({
    id: `${slugify(company.name)}:${j.id}`,
    title: j.title,
    company: company.name,
    location: j.locationName || 'Unknown',
    url: `https://jobs.ashbyhq.com/${slug}/${j.id}`,
    postedAt: null,
    description: truncate(j.employmentType || ''),
    source: 'ashby',
    score: 0,
    matchedKeywords: [],
  }))
}
